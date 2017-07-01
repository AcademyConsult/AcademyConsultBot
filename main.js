var telegram = require('telegram-bot-api');
var unifi    = require('./unifi.js');
var https    = require('https');
var ical     = require('ical');
var _        = require('underscore')._;
var Cache    = require('./cache');
var ldap     = require('ldapjs');
var fs       = require('fs');

var ca     = fs.readFileSync('activedirectory_CA.pem');
var config = require('./config.json');
var cache  = new Cache();

var bot = new telegram({
	token: config.token,
	updates: {
		enabled: true,
		pooling_timeout: config.timeout
	}
});

var controllers = [];
for (i = 0; i < config.controllers.length; i++) {
	var controller = config.controllers[i];
	controllers.push(new unifi(
		controller.uri,
		controller.username,
		controller.password,
		controller.site
	));
}

var commands = [
	{
		pattern: /\/start/,
		handler: wrapRestrictedCommand(runStart)
	},
	{
		pattern: /\/status/,
		handler: wrapRestrictedCommand(showStatus)
	},
	{
		pattern: /\/details/,
		handler: wrapRestrictedCommand(showDetails)
	},
	{
		pattern: /\/bewerbungen/,
		handler: wrapRestrictedCommand(showApplicants)
	},
	{
		pattern: /\/countdown/,
		handler: wrapRestrictedCommand(subscribe)
	},
	{
		pattern: /\/events/,
		handler: wrapRestrictedCommand(showEvents)
	},
	{
		pattern: /\/buero/,
		handler: wrapRestrictedCommand(showReservations)
	},
	{
		pattern: /\/kontakte/,
		handler: wrapRestrictedCommand(showContactsHelp)
	},
	{
		pattern: /\/bdsu/,
		handler: wrapRestrictedCommand(showBDSUEvents)
	}
];

var inline_callbacks = [
	{
		pattern: /\/room/,
		handler: wrapRestrictedCommand(showRoomDetails)
	}, {
		pattern: /\/events/,
		handler: wrapRestrictedCommand(showEvents)
	},
	{
		pattern: /\/bdsu/,
		handler: wrapRestrictedCommand(showBDSUEvents)
	}
];

var subscribers = [];
var countdown = 0;

bot.on('message', function(message) {
	if (message && message.text) {
		_.each(commands, function(command) {
			if (message.text.match(command.pattern)) {
				command.handler(message);
			}
		});
	}
});

bot.on('inline.callback.query', function(query) {
	if (query && query.data) {
		_.each(inline_callbacks, function(command) {
			if (query.data.match(command.pattern)) {
				command.handler(query);
			}
		});
	}
});

bot.on('inline.query', searchContacts);

function wrapRestrictedCommand(command) {
	return function(query) {
		getADUser(query.from.id).then(function(user) {
			if (user) {
				command(query, user);
			} else {
				var message = query.message || query;
				var text = "Dieser Bot ist nur für Mitglieder von Academy Consult München e.V. verfügbar.\n";
				if (query.from.id != message.chat.id) {
					text += "Bitte schreibe mir eine private Nachricht an @AcademyConsultBot, um dich freizuschalten.";
				} else {
					text += `Bitte [logge dich hier ein](https://www.acintern.de/telegram?id=${query.from.id}), um dich freizuschalten.`;
				}
				bot.sendMessage({
					chat_id: message.chat.id,
					parse_mode: 'Markdown',
					text: text
				}).catch(_.noop);
			}
		}).catch(function() {
			if (query.data) {
				bot.answerCallbackQuery({
					callback_query_id: query.id,
					text: 'Fehler beim Laden der Benutzerdaten'
				}).catch(_.noop);
			} else {
				bot.sendMessage({
					chat_id: query.chat.id,
					text: 'Fehler beim Laden der Benutzerdaten',
				}).catch(_.noop);
			}
		});
	}
}

function getADUser(uid) {
	return cache.get(`aduser.${uid}`, function(store, reject) {
		var client = ldap.createClient({
			url: config.ldap.uri,
			tlsOptions: {
				ca: ca
			}
		});
		client.bind(config.ldap.binddn, config.ldap.bindpw, function(err, res) {
			if (err) {
				console.error(err);
				reject();
				return;
			}

			var opts = {
				filter: `(&(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2))(${config.ldap.uid_attribute}=${uid}))`,
				scope: 'sub',
				attributes: ['givenName', 'displayName', config.ldap.uid_attribute]
			};

			client.search(config.ldap.basedn, opts, function(err, res) {
				if (err) {
					console.error(err);
					client.destroy();
					reject();
					return;
				}

				var data;
				res.on('searchEntry', function(entry) {
					data = entry.object;
				});
				res.on('error', function(err) {
					console.error(err);
					client.destroy();
					reject();
				});
				res.on('end', function(result) {
					client.destroy();
					if (result.status != 0) {
						console.error(result);
						reject();
					} else {
						if (data) {
							store(data, 86400000);
						} else {
							store(data, 1000);
						}
					}
				});
			});
		});
	});
}

function runStart(message, user) {
	bot.sendMessage({
		chat_id: message.chat.id,
		text: `Hallo ${user.givenName}! Was kann ich für dich tun?`
	}).catch(_.noop);
}

function showStatus(message) {
	_.each(controllers, function(controller, i) {
		bot.sendChatAction({
			chat_id: message.chat.id,
			action: 'typing'
		}).catch(_.noop);
		controller.ApiCall('api/s/default/stat/device').then(function(data) {
			var stats = {
				users: 0,
				guests: 0,
				aps: 0,
				inactive: 0
			}
			_.each(data, function(ap) {
				if (ap.state == 1) {
					stats.aps++;
					stats.users += ap['user-num_sta'];
					stats.guests += ap['guest-num_sta'];
				} else {
					stats.inactive++;
				}
			});

			if (config.controllers[i].whitelist && config.controllers[i].whitelist.indexOf(message.chat.id) == -1) {
				bot.sendMessage({
					chat_id: message.chat.id,
					reply_to_message_id: message.message_id,
					text: `Geräte online: ${stats.users + stats.guests}`
				}).catch(_.noop);
			} else {
				bot.sendMessage({
					chat_id: message.chat.id,
					reply_to_message_id: message.message_id,
					text: `UniFi-Controller "${config.controllers[i].name}":\n` +
						`APs: ${stats.aps}/${stats.inactive}\n` +
						`users/guests: ${stats.users}/${stats.guests}`
				}).catch(_.noop);
			}
		}).catch(function(msg) {
			bot.sendMessage({
				chat_id: message.chat.id,
				reply_to_message_id: message.message_id,
				text: `Error talking to controller "${config.controllers[i].name}": ${msg}`
			}).catch(_.noop);
		});
	});
}

function showDetails(message) {
	_.each(controllers, function(controller, i) {
		bot.sendChatAction({
			chat_id: message.chat.id,
			action: 'typing'
		}).catch(_.noop);
		controller.ApiCall('api/s/default/stat/sta').then(function(data) {
			var stats = {
				users: 0,
				guests: 0,
				names: []
			}
			_.each(data, function(client) {
				if (client._is_guest_by_uap) {
					stats.guests++;
				} else {
					stats.users++;
				}
				if (client.name) {
					stats.names.push(client.name);
				}
			});

			stats.names = _.uniq(_.sortBy(stats.names, function(name) {return name}), true);

			bot.sendMessage({
				chat_id: message.chat.id,
				reply_to_message_id: message.message_id,
				text: `Geräte online: ${stats.users + stats.guests}\n` +
					`Namen: ${stats.names.join(', ')}`
			}).catch(_.noop);
		}).catch(function(msg) {
			bot.sendMessage({
				chat_id: message.chat.id,
				reply_to_message_id: message.message_id,
				text: `Error talking to controller "${config.controllers[i].name}": ${msg}`
			}).catch(_.noop);
		});
	});
}

_.each(controllers, function(controller, i) {
	if (config.controllers[i].subscribers && config.controllers[i].subscribers.length) {
		setInterval(controller.handleAlarms, 10000, function(alarm) {
				if (alarm.msg) {
					var msg = alarm.msg;
					if (alarm.ap && alarm.ap_name) {
						msg = msg.replace(alarm.ap, alarm.ap_name);
					}
					var ts = new Date(alarm.time);
					var timestring = `${ts.getDate()}.${ts.getMonth() + 1}.${ts.getFullYear()} ${ts.toLocaleTimeString()}`;
					var text = `New alert on "${config.controllers[i].name}" at ${timestring}:\n${msg}`;
					_.each(config.controllers[i].subscribers, function(subscriber) {
						bot.sendSticker({
							chat_id: subscriber,
							sticker: "BQADAgADJwwAAkKvaQABUq7QF_-jeCkC" // bee doo bee doo
						}).catch(_.noop);
						bot.sendMessage({
							chat_id: subscriber,
							text: text
						}).catch(_.noop);
					});
					return true;
				}
				return false;
			}
		);
	}
});

function _sendCountdown(chat_id) {
	bot.sendMessage({
		chat_id: chat_id,
		text: `Aktuelle Anzahl Bewerbungen: ${countdown}`
	}).catch(_.noop);
}

setInterval(_updateCountdown, 30000);

function _updateCountdown(callback) {
	callback = callback || function() {};
	var options = {
		host: config.countdown.host,
		port: 443,
		path: config.countdown.path,
		method: 'GET'
	};

	https.get(options, function(res) {
		var json = '';
		res.on('data', function(chunk) {
			json += chunk;
		});
		res.on('end', function() {
			var changed = false;
			try {
				var data = JSON.parse(json);
				changed = countdown != data.count;
				countdown = data.count;
				if (changed) {
					_.each(subscribers, _sendCountdown);
				}
			} catch (error) {
				console.error(error);
				console.error('json was:', json);
			}
			callback(changed);
		});
	});
}

function showApplicants(message) {
	bot.sendChatAction({
		chat_id: message.chat.id,
		action: 'typing'
	}).catch(_.noop);
	var chat_id = message.chat.id;
	_updateCountdown(function(changed) {
		if (!changed || subscribers.indexOf(chat_id) == -1) {
			_sendCountdown(message.chat.id);
		}
	});
}

function subscribe(message) {
	var index = subscribers.indexOf(message.chat.id);
	if (index == -1) {
		subscribers.push(message.chat.id);
		bot.sendMessage({
			chat_id: message.chat.id,
			text: 'Du erhälst jetzt automatische Updates, wenn neue Bewerbungen rein kommen'
		}).catch(_.noop);
	} else {
		subscribers.splice(index, 1);
		bot.sendMessage({
			chat_id: message.chat.id,
			text: 'Automatische Updates deaktiviert'
		}).catch(_.noop);
	}
}

function addLeading0s(string) {
	return string.replace(/(^|\D)(?=\d(?!\d))/g, '$10');
}

function getShortDateString(date, is_end) {
	if (is_end) {
		date = new Date(date - 1);
	}
	return addLeading0s([date.getDate(), (date.getMonth()+1), ''].join('.'));
}

function getShortTimeString(date, is_end) {
	var time = addLeading0s([date.getHours(), date.getMinutes()].join(':'));
	if (is_end && time == '00:00') {
		time = '24:00';
	}
	return time;
}

function filterEvents(events, count, after, before) {
	after = new Date(after);
	before = new Date(before);

	var results = _.filter(events, function(event) {
		return event.end > after || event.start < before;
	});

	var ascending = !before.getTime();
	if (count && results.length >= count) {
		results = _.sortBy(results, 'start').splice(ascending ? 0 : -count, count);
		after  =  ascending ? after  : _.min(results, function(event) {return event.start}).start;
		before = !ascending ? before : _.max(results, function(event) {return event.end  }).end;
	}

	_.each(events, function(event) {
		if (event.rrule) {
			_.each(event.rrule.between(after, before), function(newstart) {
				if (newstart.getTime() != event.start.getTime()) {
					results.push({
						summary: event.summary,
						start: newstart,
						end: new Date(event.end.getTime() + (newstart - event.start))
					});
				}
			});
		}
	});

	results = _.sortBy(results, 'start');
	return count ? results.splice(ascending ? 0 : -count, count) : results;
}

function showEvents(query) {
	var after, before;
	if (query.data) {
		var parts = query.data.match(/\/events(?: after:([0-9]+))?(?: before:([0-9]+))?/);
		after = Number.parseInt(parts[1]);
		before = Number.parseInt(parts[2]);
		message = query.message;
	} else {
		message = query;
		query = false;
	}

	bot.sendChatAction({
		chat_id: message.chat.id,
		action: 'typing'
	}).catch(_.noop);

	if (!after && !before) {
		after = Date.now();
	}

	cache.get('calendars.events', function(store, reject) {
		ical.fromURL(config.events.ical, {}, function(err, data) {
			if (err) {
				reject(err);
			} else {
				store(data, 120000);
			}
		});
	}).then(function(data) {
		var events = filterEvents(data, 5, after, before);

		var text = `[Aktuelle AC-Events](${config.events.html}):\n`;
		var markup;

		if (events.length) {
			if (before) {
				events = events.splice(-5);
			} else {
				events = events.splice(0, 5);
			}

			var lines = [];
			_.each(events, function(event) {
				var dateString = getShortDateString(event.start);
				var timeString = '';
				if (event.end - event.start > 86400000) { // more than 24h
					dateString += ` - ${getShortDateString(event.end, true)}`;
				} else if (event.end - event.start < 86400000) { // less than 24h, i.e. NOT an all-day event
					timeString = ` (${getShortTimeString(event.start)} Uhr)`
				}
				lines.push(`${dateString}: *${event.summary}*${timeString}`);
			});

			markup = JSON.stringify({
				inline_keyboard: [[
					{text: '<< früher', callback_data: '/events before:' + _.min(events, function(event) {return event.start}).start.getTime()},
					{text: 'jetzt', callback_data: '/events'},
					{text: 'später >>', callback_data: '/events after:' + _.max(events, function(event) {return event.start}).start.getTime()}
				]]
			});
			text += lines.join("\n");
		} else {
			var buttons = [{text: 'jetzt', callback_data: '/events'}];
			if (before) {
				buttons.push({text: 'später >>', callback_data: '/events after:' + (before - 1)});
			} else {
				buttons.unshift({text: '<< früher', callback_data: '/events before:' + (after + 1)});
			}

			markup = JSON.stringify({
				inline_keyboard: [buttons]
			});
			text += 'Keine Events in diesem Zeitraum vorhanden';
		}

		if (query) {
			bot.editMessageText({
				chat_id: query.message.chat.id,
				message_id: query.message.message_id,
				reply_markup: markup,
				parse_mode: 'Markdown',
				text: text
			}).catch(_.noop);
			bot.answerCallbackQuery({
				callback_query_id: query.id
			}).catch(_.noop);
		} else {
			bot.sendMessage({
				chat_id: message.chat.id,
				parse_mode: 'Markdown',
				text: text,
				reply_markup: markup
			}).catch(_.noop);
		}
	}).catch(function(err) {
		console.error(err);
	});
}

function showReservations(message) {
	bot.sendChatAction({
		chat_id: message.chat.id,
		action: 'typing'
	}).catch(_.noop);

	var promises = [];

	var now = new Date();
	_.each(config.rooms, function(urls, room) {
		promises.push(cache.get(`calendars.${room}`, function(store, reject) {
			ical.fromURL(urls.ical, {}, function(err, data) {
				if (err) {
					reject(`Fehler beim Laden von ${room}`);
				} else {
					store(data, 120000);
				}
			});
		}).then(function(data) {
			var reservations = filterEvents(data, 0, now);
			var line = '';

			var reservation = reservations.shift();
			if (reservation) {
				if (reservation.start <= now) {
					var next;
					var users = [reservation.summary.trim()];
					while ((next = reservations.shift()) && next.start - reservation.end < 900000) { // less than 15min until next reservation
						users.push(next.summary.trim());
						reservation = next;
					}
					line = 'belegt bis '
						+ (reservation.end - now > 86400000 ? getShortDateString(reservation.end, true) + ', ' : '')
						+ getShortTimeString(reservation.end, true) + ' Uhr von ' + _.uniq(users).join(', ');
				} else {
					line = 'frei bis '
						+ (reservation.start - now > 86400000 ? getShortDateString(reservation.start) + ', ' : '')
						+ getShortTimeString(reservation.start) + ' Uhr';
				}
			} else {
				line = 'frei';
			}

			return {room, line};
		}));
	});

	Promise.all(promises).then(function(results) {
		var lines = {};
		var rooms = [];
		var markup = {inline_keyboard: []};

		_.each(results, function(result) {
			lines[result.room] = result.line;
		});

		_.each(config.rooms, function(urls, room) {
			rooms.push(`[${room}](${urls.html}): ${lines[room]}`);
			markup.inline_keyboard.push([{text: room, callback_data: `/room ${room}`}]);
		});

		bot.sendMessage({
			chat_id: message.chat.id,
			parse_mode: 'Markdown',
			text: rooms.join("\n"),
			reply_markup: JSON.stringify(markup)
		}).catch(_.noop);
	}).catch(function(err) {
		console.error(err);
	});
}

function showRoomDetails(query) {
	var parts = query.data.match(/\/room (\w+)(?: after:([0-9]+))?(?: before:([0-9]+))?/);
	var room = parts[1];
	var after = Number.parseInt(parts[2]);
	var before = Number.parseInt(parts[3]);
	if (!config.rooms[room]) {
		console.error('unknown room requested');
		console.debug(query);
		return;
	}

	bot.sendChatAction({
		chat_id: query.message.chat.id,
		action: 'typing'
	}).catch(_.noop);

	if (!after && !before) {
		after = Date.now();
	}

	cache.get(`calendars.${room}`, function(store, reject) {
		ical.fromURL(config.rooms[room].ical, {}, function(err, data) {
			if (err) {
				reject(err);
			} else {
				store(data, 120000);
			}
		});
	}).then(function(data) {
		var reservations = filterEvents(data, 5, after, before);

		if (reservations.length) {
			if (before) {
				reservations = reservations.splice(-5);
			} else {
				reservations = reservations.splice(0, 5);
			}

			var lines = [];
			_.each(reservations, function(reservation) {
				var start_time = getShortTimeString(reservation.start);
				var start_date = getShortDateString(reservation.start);
				var end_time = getShortTimeString(reservation.end, true);
				var end_date = getShortDateString(reservation.end, true);
				var time = '';
				if (reservation.end - reservation.start > 86400000) {
					if (start_time == '00:00' && end_time == '24:00') {
						time = `${start_date} - ${end_date}`;
					} else {
						time = `${start_date}, ${start_time} Uhr - ${end_date}, ${end_time} Uhr`;
					}
				} else {
					if (start_time == '00:00' && end_time == '24:00') {
						time = start_date;
					} else {
						time = `${start_date}, ${start_time} - ${end_time} Uhr`;
					}
				}
				lines.push(`${time}: ${reservation.summary}`);
			});

			bot.editMessageText({
				chat_id: query.message.chat.id,
				message_id: query.message.message_id,
				reply_markup: JSON.stringify({
					inline_keyboard: [[
						{text: '<< früher', callback_data: `/room ${room} before:` + _.min(reservations, function(reservation) {return reservation.start}).start.getTime()},
						{text: 'jetzt', callback_data: `/room ${room}`},
						{text: 'später >>', callback_data: `/room ${room} after:` + _.max(reservations, function(reservation) {return reservation.start}).start.getTime()}
					]]
				}),
				parse_mode: 'Markdown',
				text: `Reservierungen im [${room}](${config.rooms[room].html}):\n` + lines.join("\n")
			}).catch(_.noop);
		} else {
			var buttons = [{text: 'jetzt', callback_data: `/room ${room}`}];
			if (before) {
				buttons.push({text: 'später >>', callback_data: `/room ${room} after:` + (before - 1)});
			} else {
				buttons.unshift({text: '<< früher', callback_data: `/room ${room} before:` + (after + 1)});
			}

			bot.editMessageText({
				chat_id: query.message.chat.id,
				message_id: query.message.message_id,
				reply_markup: JSON.stringify({
					inline_keyboard: [buttons]
				}),
				parse_mode: 'Markdown',
				text: `[${room}](${config.rooms[room].html})\nkeine Reservierungen für diesen Zeitraum vorhanden`
			}).catch(_.noop);
		}
		bot.answerCallbackQuery({
			callback_query_id: query.id
		}).catch(_.noop);
	}).catch(function(err) {
		console.error(err);
		bot.answerCallbackQuery({
			callback_query_id: query.id,
			text: 'Fehler beim Laden'
		}).catch(_.noop);
	});
}

function fetchContacts(save, reject) {
	var client = ldap.createClient({
		url: config.ldap.uri,
		tlsOptions: {
			ca: ca
		}
	});

	client.bind(config.ldap.binddn, config.ldap.bindpw, function(err, res) {
		if (err) {
			client.destroy();
			reject(err);
			return;
		}

		var opts = {
			filter: '(&(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2))(mobile=*))',
			scope: 'sub',
			attributes: ['givenName', 'sn', 'displayName', 'name', 'mobile']
		};

		client.search(config.ldap.basedn, opts, function(err, res) {
			if (err) {
				client.destroy();
				reject(err);
				return;
			}

			var data = [];
			res.on('searchEntry', function(entry) {
				data.push(entry.object);
			});
			res.on('error', function(err) {
				client.destroy();
				reject(err);
			});
			res.on('end', function(result) {
				client.destroy();
				save(_.sortBy(data, 'displayName'), 43200000);
			});
		});
	});
}

function showContactsHelp(message, user) {
	bot.sendMessage({
		chat_id: message.chat.id,
		text: "Du kannst in jedem Chat nach Telefonnummern von AClern suchen und sie direkt mit deinem Gegenüber teilen.\n"
			+ "Dazu musst du nur in deine Eingabezeile \"@AcademyConsultBot\" gefolgt von einem Namen eingeben. "
			+ "Es werden dabei nur Kontakte angezeigt, für die eine Handynummer im SharePoint hinterlegt wurde!\n"
			+ "Für ein Beispiel drücke einen der Buttons:",
		reply_markup: JSON.stringify({
			inline_keyboard: [
				[{text: 'direkt hier', switch_inline_query_current_chat: user.givenName}],
				[{text: 'anderer Chat', switch_inline_query: user.givenName}]
			]
		})
	}).catch(_.noop);
}

function searchContacts(query) {
	var max_results = 15;
	var next_result;
	getADUser(query.from.id).then(function(user) {
		if (!user) {
			bot.answerInlineQuery({
				inline_query_id: query.id,
				results: [],
				is_personal: 'true',
				cache_time: 0,
				switch_pm_text: 'Bitte erst einloggen',
				switch_pm_parameter: 'contacts'
			});
		} else {
			cache.get('contacts', fetchContacts).then(function(contacts) {
				var results = _.filter(contacts, function(contact) {
					return -1 != contact.name.toLowerCase().indexOf(query.query.toLowerCase());
				});
				if (query.offset) {
					results = results.splice(query.offset);
				}
				if (results.length > max_results) {
					next_result = max_results + Number.parseInt(query.offset ? query.offset : 0);
					results = results.splice(0, max_results);
				}
				results = _.map(results, function(contact) {
					return {
						type: 'contact',
						id: contact.name,
						phone_number: contact.mobile,
						first_name: contact.givenName,
						last_name: contact.sn
					}
				});
				bot.answerInlineQuery({
					inline_query_id: query.id,
					results: results,
					is_personal: 'true',
					cache_time: 0,
					next_offset: next_result
				});
			}).catch(function(err) {
				console.error(err);
			});
		}
	}).catch(function(err) {
		console.error(err);
	});
}

function showBDSUEvents(query) {
	var after, before;
	if (query.data) {
		var parts = query.data.match(/\/bdsu(?: after:([0-9]+))?(?: before:([0-9]+))?/);
		after = Number.parseInt(parts[1]);
		before = Number.parseInt(parts[2]);
		message = query.message;
	} else {
		message = query;
		query = false;
	}

	bot.sendChatAction({
		chat_id: message.chat.id,
		action: 'typing'
	}).catch(_.noop);

	if (!after && !before) {
		after = Date.now();
	}

	cache.get('calendars.bdsu', function(store, reject) {
		var promises = [];

		_.each(config.bdsu, function(calendar, index) {
			promises.push(cache.get(`calendars.bdsu.${index}`, function(store, reject) {
				ical.fromURL(calendar, {}, function(err, data) {
					if (err) {
						Promise.reject(err);
					} else {
						store(data, 120000);
					}
				});
			}));
		})

		promises.push(
			cache.get('calendars.events', function(store, reject) {
				ical.fromURL(config.events.ical, {}, function(err, data) {
					if (err) {
						reject(err);
					} else {
						store(data, 120000);
					}
				});
			}).then(function(data) {
				return _(data).filter(function(event) {
					return event.summary && event.summary.match(/BDSU|Bayern ?(\+|plus)|Kongress/i)
				});
			})
		);

		Promise.all(promises).then(function(calendars) {
			var events = {};
			_.each(calendars, function(calendar_events) {
				_(events).extend(calendar_events);
			});
			store(events, 120000);
		}).catch(reject);
	}).then(function(data) {
		var events = filterEvents(data, 5, after, before);

		var text = "Aktuelle BDSU-Treffen:\n";
		var markup;

		if (events.length) {
			if (before) {
				events = events.splice(-5);
			} else {
				events = events.splice(0, 5);
			}

			var lines = [];
			_.each(events, function(event) {
				var dateString = getShortDateString(event.start);
				var timeString = '';
				if (event.end - event.start > 86400000) { // more than 24h
					dateString += ` - ${getShortDateString(event.end, true)}`;
				} else if (event.end - event.start < 86400000) { // less than 24h, i.e. NOT an all-day event
					timeString = ` (${getShortTimeString(event.start)} Uhr)`
				}
				lines.push(`${dateString}: [${event.summary}${event.location ? ` (${event.location})` : ''}](${event.url})${timeString}`);
			});

			markup = JSON.stringify({
				inline_keyboard: [[
					{text: '<< früher', callback_data: '/bdsu before:' + _.min(events, function(event) {return event.start}).start.getTime()},
					{text: 'jetzt', callback_data: '/bdsu'},
					{text: 'später >>', callback_data: '/bdsu after:' + _.max(events, function(event) {return event.start}).end.getTime()}
				]]
			});
			text += lines.join("\n");
		} else {
			var buttons = [{text: 'jetzt', callback_data: '/bdsu'}];
			if (before) {
				buttons.push({text: 'später >>', callback_data: '/bdsu after:' + (before - 1)});
			} else {
				buttons.unshift({text: '<< früher', callback_data: '/bdsu before:' + (after + 1)});
			}

			markup = JSON.stringify({
				inline_keyboard: [buttons]
			});
			text += 'Keine Events in diesem Zeitraum vorhanden';
		}

		if (query) {
			bot.editMessageText({
				chat_id: query.message.chat.id,
				message_id: query.message.message_id,
				reply_markup: markup,
				parse_mode: 'Markdown',
				text: text
			}).catch(_.noop);
			bot.answerCallbackQuery({
				callback_query_id: query.id
			}).catch(_.noop);
		} else {
			bot.sendMessage({
				chat_id: message.chat.id,
				parse_mode: 'Markdown',
				text: text,
				reply_markup: markup
			}).catch(_.noop);
		}
	}).catch(function(err) {
		console.error(err);
	});
}

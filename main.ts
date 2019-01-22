import telegram  from 'telegram-bot-api';
import { Unifi } from './unifi';
import https     from 'https';
import ical      from 'node-ical';
import { _ }     from 'underscore';
import { Cache } from './cache';
import ldap      from 'ldapjs';
import fs        from 'fs';

// force local timezone to be UTC
// rrule is quite buggy when the system time is not UTC,
// e.g. time shifts around switch to/from DST
process.env.TZ = 'UTC';

var ca     = fs.readFileSync('activedirectory_CA.pem');
var config = require('./config.json');
var cache  = Cache();

var bot = new telegram({
	token: config.token,
	updates: {
		enabled: true,
		pooling_timeout: config.timeout
	}
});

var controllers = [];
for (let i = 0; i < config.controllers.length; i++) {
	var controller = config.controllers[i];
	controllers.push(new Unifi(
		controller.uri,
		controller.username,
		controller.password,
		controller.site
	));
}

var commands = [
	{
		name: '/start',
		handler: wrapRestrictedCommand(runStart)
	},
	{
		name: '/status',
		handler: wrapRestrictedCommand(showStatus)
	},
	{
		name: '/details',
		handler: wrapRestrictedCommand(showDetails)
	},
	{
		name: '/bewerbungen',
		handler: wrapRestrictedCommand(showApplicants)
	},
	{
		name: '/countdown',
		handler: wrapRestrictedCommand(subscribe)
	},
	{
		name: '/events',
		handler: wrapRestrictedCommand(showEvents)
	},
	{
		name: '/buero',
		handler: wrapRestrictedCommand(showReservations)
	},
	{
		name: '/kontakte',
		handler: wrapRestrictedCommand(showContactsHelp)
	},
	{
		name: '/bdsu',
		handler: wrapRestrictedCommand(showBDSUEvents)
	}
];

var inline_callbacks = [
	{
		pattern: /\/room/,
		handler: wrapRestrictedCommand(showRoomDetails)
	},
	{
		pattern: /\/buero/,
		handler: wrapRestrictedCommand(showReservations)
	},
	{
		pattern: /\/events/,
		handler: wrapRestrictedCommand(showEvents)
	},
	{
		pattern: /\/bdsu/,
		handler: wrapRestrictedCommand(showBDSUEvents)
	},
	{
		pattern: /^\/poll (?<query_id>[^ ]+) (?<type>.+)$/,
		handler: wrapRestrictedCommand(updateSimplePoll)
	}
];

var subscribers = [];
var countdown = 0;

bot.on('message', function(message) {
	if (message && message.text && message.entities) {
		message.entities.filter(entity => entity.type === 'bot_command').forEach(entity => {
			const command_text = message.text.substr(entity.offset, entity.length);
			commands.forEach(command => {
				if (command.name === command_text) {
					command.handler(message);
				}
			});
		});
	} else if (message && message.chat && message.chat.id == config.group.id && message.new_chat_members) {
		verifyNewChatMembers(message);
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
		getADUser(query.from.id).catch(function(error) {
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
			return Promise.reject(error);
		}).then(function(user) {
			if (user) {
				command(query, user);
			} else {
				var message = query.message || query;
				var text = "Dieser Bot ist nur für Mitglieder von Academy Consult München e.V. verfügbar.\n";
				var parse_mode = undefined;
				if (query.from.id != message.chat.id) {
					text += `Bitte schreibe mir eine private Nachricht an @${config.name}, um dich freizuschalten.`;
				} else {
					text += `Bitte [logge dich hier ein](https://www.acintern.de/telegram?id=${query.from.id}), um dich freizuschalten.`;
					parse_mode = 'Markdown';
				}
				bot.sendMessage({
					chat_id: message.chat.id,
					parse_mode: parse_mode,
					text: text
				}).catch(_.noop);
			}
		}).catch(function(error) {
			console.error(error);
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
		client.addListener('error', reject);
		client.bind(config.ldap.binddn, config.ldap.bindpw, function(err, res) {
			if (err) {
				reject(err);
				return;
			}

			var opts = {
				filter: `(&(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2))(${config.ldap.uid_attribute}=${uid}))`,
				scope: 'sub',
				attributes: ['givenName', 'displayName', config.ldap.uid_attribute]
			};

			client.search(config.ldap.basedn, opts, function(err, res) {
				if (err) {
					client.destroy();
					reject(err);
					return;
				}

				var data;
				res.on('searchEntry', function(entry) {
					data = entry.object;
				});
				res.on('error', function(err) {
					client.destroy();
					reject(err);
				});
				res.on('end', function(result) {
					client.destroy();
					if (result.status != 0) {
						reject(result);
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

function startTyping(chat_id) {
	bot.sendChatAction({
		chat_id: chat_id,
		action: 'typing'
	}).catch(_.noop);
}

function inviteUserToGroup(user_id, group_id, group_name) {
	cache.get(`inviteLink.${group_id}`, function(resolve, reject) {
		bot.exportChatInviteLink({chat_id: group_id}).then(function(inviteLink) {
			resolve(inviteLink, 86400000);
		}).catch(reject);
	}).then(function(inviteLink) {
		bot.sendMessage({
			chat_id: user_id,
			parse_mode: 'Markdown',
			text: `Tippe hier, um [der "${group_name}"-Gruppe beizutreten](${inviteLink}).`
		}).catch(_.noop);
	}).catch(function(error) {
		console.error(error);
	});
}

function runStart(message, user) {
	if (message.from.id === message.chat.id) {
		bot.sendMessage({
			chat_id: message.from.id,
			text: `Hallo ${user.givenName}! Was kann ich für dich tun?`
		}).catch(_.noop);

		var _inviteUser = function() {
			inviteUserToGroup(message.from.id, config.group.id, config.group.name);
		};

		bot.getChatMember({chat_id: config.group.id, user_id: message.from.id}).then(function(member) {
			if (member && member.status == 'kicked') {
				bot.unbanChatMember({
					chat_id: config.group.id,
					user_id: message.from.id
				});
			}
			if (member && (member.status == 'left' || member.status == 'kicked')) {
				_inviteUser();
			}
		}).catch(_inviteUser); // user was never in the group before
	}
}

function verifyNewChatMembers(message) {
	var promises = _(message.new_chat_members).map(function(member) {
		return getADUser(member.id).then(function(user) {
			return {user, member};
		}).catch(function(err) {
			console.error(err);
			return {user: false, member};
		});
	});
	Promise.all(promises).then(function(users) {
		_.chain(users).filter(function(user) {
			return !user.user;
		}).each(function(user) {
			bot.kickChatMember({
				chat_id: message.chat.id,
				user_id: user.member.id
			}).catch(_.noop);
		});
	}).catch(function(err) {
		console.error(err);
	});
}

function _showControllerInfos(message, endpoint, parser, formatter) {
	_.each(controllers, function(controller, i) {
		startTyping(message.chat.id);
		controller.ApiCall(endpoint).then(function(data) {
			var stats = {
				users: 0,
				guests: 0,
				aps: 0,
				inactive: 0,
				names: []
			}
			_.each(data, parser, stats);

			stats.names = _.uniq(_.sortBy(stats.names, function(name) {return name}), true);

			bot.sendMessage({
				chat_id: message.chat.id,
				reply_to_message_id: message.message_id,
				text: formatter(stats, controller, i)
			}).catch(_.noop);
		}).catch(function(msg) {
			bot.sendMessage({
				chat_id: message.chat.id,
				reply_to_message_id: message.message_id,
				text: `Controller nicht erreichbar "${config.controllers[i].name}": ${msg}`
			}).catch(_.noop);
		});
	});
}

function showDetails(message) {
	_showControllerInfos(
		message,
		'api/s/default/stat/sta',
		function(client) {
			var stats = this;
			if (config.excluded_essids.indexOf(client.essid) > -1) {
				return;
			}
			if (client._is_guest_by_uap) {
				stats.guests++;
			} else {
				stats.users++;
			}
			if (client.name) {
				stats.names.push(client.name);
			}
		},
		function(stats) {
			return `Geräte online: ${stats.users + stats.guests}\n` +
				`Namen: ${stats.names.join(', ')}`;
		}
	);
}

function showStatus(message) {
	_showControllerInfos(
		message,
		'api/s/default/stat/device',
		function(ap) {
			var stats = this;
			if (ap.state == 1) {
				stats.aps++;
				stats.users += ap['user-num_sta'];
				stats.guests += ap['guest-num_sta'];
			} else {
				stats.inactive++;
			}
		},
		function(stats, controller, i) {
			if (config.controllers[i].whitelist && config.controllers[i].whitelist.indexOf(message.chat.id) == -1) {
				return `Geräte online: ${stats.users + stats.guests}`;
			} else {
				return `UniFi-Controller "${config.controllers[i].name}":\n` +
					`APs: ${stats.aps}/${stats.inactive}\n` +
					`users/guests: ${stats.users}/${stats.guests}`;
			}
		}
	);
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
	startTyping(message.chat.id);
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
			text: 'Du erhälst jetzt automatische Updates, wenn neue Bewerbungen rein kommen',
		}).catch(_.noop);
	} else {
		subscribers.splice(index, 1);
		bot.sendMessage({
			chat_id: message.chat.id,
			text: 'Automatische Updates deaktiviert',
		}).catch(_.noop);
	}
}

function addLeading0s(string) {
	return string.replace(/(^|\D)(?=\d(?!\d))/g, '$10');
}

function getShortDateString(date, is_end?) {
	if (is_end) {
		date = new Date(date - 1);
	}
	return addLeading0s([date.getDate(), (date.getMonth()+1), ''].join('.'));
}

function getShortTimeString(date, is_end?) {
	var time = addLeading0s([date.getHours(), date.getMinutes()].join(':'));
	if (is_end && time == '00:00') {
		time = '24:00';
	}
	return time;
}

function filterEvents(events, count, after, before?) {
	after = new Date(after);
	before = new Date(before);

	var results = _.filter(events, function(event) {
		return event.end > after || event.start < before;
	});

	_.filter(events, event => event.recurrences).forEach(event => {
		_.each(event.recurrences, recurrence => {
			if (recurrence.end > after || recurrence.start < before) {
				results.push(recurrence);
			}
		});
	});

	var ascending = !before.getTime();
	if (count && results.length >= count) {
		results = _.sortBy(results, 'start').splice(ascending ? 0 : -count, count);
		after  =  ascending ? after  : _.min(results, function(event) {return event.start}).start;
		before = !ascending ? before : _.max(results, function(event) {return event.end  }).end;
	}

	_.each(events, function(event) {
		if (event.rrule) {
			let recurrences;
			if (after.getTime() && before.getTime()) {
				recurrences = event.rrule.between(after, before);
			} else if (after.getTime()) {
				recurrences = event.rrule.after(after);
			} else {
				recurrences = event.rrule.before(before);
			}
			_.each(recurrences, function(newstart) {
				if (newstart.getTime() != event.start.getTime()) {
					// only add events by rrule if it is not already included as
					// its own instance
					if (!event.recurrences || !event.recurrences[newstart.toISOString()]) {
						results.push({
							summary: event.summary,
							start: newstart,
							end: new Date(event.end.getTime() + (newstart - event.start))
						});
					}
				}
			});
		}
	});

	results = _.sortBy(results, 'start');
	return count ? results.splice(ascending ? 0 : -count, count) : results;
}

function loadCalendar(cache_key, url, ttl?) {
	ttl = ttl || 120000;
	return cache.get(cache_key, function(store, reject) {
		ical.fromURL(url, {}, function(err, data) {
			if (err) {
				reject(err);
			} else {
				store(data, ttl);
			}
		});
	});
}

function _renderPaginatedCalendar(query, command, calendar_promise, header, line_renderer) {
	var after, before;
	var message;
	if (query.data) {
		var parts = query.data.match(new RegExp(`\/${command}(?: after:([0-9]+))?(?: before:([0-9]+))?`));
		after = Number.parseInt(parts[1]);
		before = Number.parseInt(parts[2]);
		message = query.message;
	} else {
		message = query;
		query = false;
	}

	startTyping(message.chat.id);

	if (!after && !before) {
		after = Date.now();
	}

	calendar_promise.then(function(data) {
		var events = filterEvents(data, 5, after, before);

		var text = header;
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
				lines.push(line_renderer(dateString, timeString, event));
			});

			markup = JSON.stringify({
				inline_keyboard: [[
					{text: '<< früher', callback_data: `/${command} before:` + _.min(events, function(event) {return event.start}).start.getTime()},
					{text: 'jetzt', callback_data: `/${command}`},
					{text: 'später >>', callback_data: `/${command} after:` + _.max(events, function(event) {return event.start}).start.getTime()}
				]]
			});
			text += lines.join("\n");
		} else {
			var buttons = [{text: 'jetzt', callback_data: `/${command}`}];
			if (before) {
				buttons.push({text: 'später >>', callback_data: `/${command} after:` + (before - 1)});
			} else {
				buttons.unshift({text: '<< früher', callback_data: `/${command} before:` + (after + 1)});
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

function showEvents(query) {
	_renderPaginatedCalendar(
		query,
		'events',
		loadCalendar('calendars.events', config.events.ical),
		`[Aktuelle AC-Events](${config.events.html}):\n`,
		function(dateString, timeString, event) {
			return `${dateString}: *${event.summary}*${timeString}`;
		}
	);
}

function showBDSUEvents(query) {
	var events = cache.get('calendars.bdsu', function(store, reject) {
		return loadCalendar('calendars.events', config.events.ical).then(function(data) {
			let events = _(data).filter(function(event) {
				return event.summary && event.summary.match(/BDSU|Bayern ?(\+|plus)|Kongress|JADE|CCT/i)
			});
			store(events, 120000);
		}).catch(reject);
	});

	_renderPaginatedCalendar(
		query,
		'bdsu',
		events,
		"Aktuelle BDSU-Treffen:\n",
		function(dateString, timeString, event) {
			return `${dateString}: [${event.summary}${event.location ? ` (${event.location})` : ''}](${event.url})${timeString}`;
		}
	);
}

function showReservations(query) {
	var message = query.data ? query.message : query;
	startTyping(message.chat.id);

	var promises = [];

	var now = Date.now();
	_.each(config.rooms, function(urls, room) {
		promises.push(loadCalendar(`calendars.${room}`, urls.ical).then(function(data) {
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

		if (query.data) {
			bot.editMessageText({
				chat_id: query.message.chat.id,
				message_id: query.message.message_id,
				parse_mode: 'Markdown',
				text: rooms.join("\n"),
				reply_markup: JSON.stringify(markup)
			}).catch(_.noop);
			bot.answerCallbackQuery({
				callback_query_id: query.id
			}).catch(_.noop);
		} else {
			bot.sendMessage({
				chat_id: message.chat.id,
				parse_mode: 'Markdown',
				text: rooms.join("\n"),
				reply_markup: JSON.stringify(markup)
			}).catch(_.noop);
		}
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

	startTyping(query.message.chat.id);

	if (!after && !before) {
		after = Date.now();
	}

	loadCalendar(`calendars.${room}`, config.rooms[room].ical).then(function(data) {
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
					], [
						{text: 'Alle Räume', callback_data: '/buero'}
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
					inline_keyboard: [buttons, [{text: 'Alle Räume', callback_data: '/buero'}]]
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
			attributes: ['givenName', 'sn', 'displayName', 'name', 'mobile', 'mail']
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
			+ `Dazu musst du nur in deine Eingabezeile \"@${config.name}\" gefolgt von einem Namen eingeben. `
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
				if (!results.length) {
					return getSimplePollResults(query);
				}
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
						last_name: contact.sn,
						vcard: `BEGIN:VCARD
							VERSION:2.1
							N:${contact.sn};${contact.givenName};;;
							FN:${contact.displayName}
							TEL;CELL:${contact.mobile}
							EMAIL;WORK:${contact.mail}
							ORG:Academy Consult
							END:VCARD`.replace(/\n\t+/g, "\n")
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

let polls = {};
function getSimplePollReplyMarkup(query_id) {
	return {
		inline_keyboard: Object.keys(config.simple_poll.buttons).map(type => {
			return [{text: config.simple_poll.buttons[type], callback_data: `/poll ${query_id} ${type}`}]
		})
	};
}

function getSimplePollResults(query) {
	polls[query.id] = {
		text: query.query,
		user: query.from,
		answers: {},
	};
	Object.keys(config.simple_poll.buttons).forEach(type => polls[query.id].answers[type] = []);
	bot.answerInlineQuery({
		inline_query_id: query.id,
		results: [{
			type: 'article',
			id: query.id,
			title: config.simple_poll.title,
			description: query.query,
			input_message_content: {
				message_text: query.query,
			},
			reply_markup: getSimplePollReplyMarkup(query.id),
		}],
		is_personal: 'true',
		cache_time: 0,
	}).catch(console.log);
}

function updateSimplePoll(query, user) {
	let match = query.data.match(/^\/poll (?<query_id>[^ ]+) (?<type>.+)$/);
	if (!match || !polls[match.groups.query_id]) {
		bot.answerCallbackQuery({
			callback_query_id: query.id,
			text: 'Anfrage nicht mehr gefunden',
		}).catch(_.noop);
		return;
	}

	let inlineQuery = polls[match.groups.query_id];
	let text = inlineQuery.text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');

	Object.keys(inlineQuery.answers).forEach(type => {
		let existing = inlineQuery.answers[type].find(user => user.id == query.from.id);
		if (existing) {
			let index = inlineQuery.answers[type].indexOf(existing);
			inlineQuery.answers[type].splice(index, 1);
		} else if (type == match.groups.type) {
			inlineQuery.answers[type].push({first_name: user.givenName, id: query.from.id});
		}
	});

	let answerTexts = Object.keys(config.simple_poll.buttons).map(type => {
		if (inlineQuery.answers[type].length) {
			return `${config.simple_poll.buttons[type]}: ` + inlineQuery.answers[type].map(user => {
				return `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
			}).join(', ');
		}
	}).filter(answer => answer);

	if (answerTexts.length) {
		text = `${text}\n--\n${answerTexts.join("\n")}`;
	}

	bot.editMessageText({
		inline_message_id: query.inline_message_id,
		parse_mode: 'HTML',
		text: text,
		reply_markup: JSON.stringify(getSimplePollReplyMarkup(match.groups.query_id)),
	}).catch(_.noop);
	bot.answerCallbackQuery({
		callback_query_id: query.id,
	}).catch(_.noop);
}

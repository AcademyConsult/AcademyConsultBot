var telegram = require('telegram-bot-api');
var unifi    = require('./unifi.js');
var https    = require('https');
var ical     = require('ical');
var _        = require('underscore')._;

var config = require('./config.json');

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
		pattern: /\/status/,
		handler: showStatus
	},
	{
		pattern: /\/details/,
		handler: showDetails
	},
	{
		pattern: /\/bewerbungen/,
		handler: showApplicants
	},
	{
		pattern: /\/countdown/,
		handler: subscribe
	},
	{
		pattern: /\/events/,
		handler: showEvents
	},
	{
		pattern: /\/buero/,
		handler: showReservations
	}
];

var inline_callbacks = [
	{
		pattern: /\/room/,
		handler: showRoomDetails
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

function showStatus(message) {
	_.each(controllers, function(controller, i) {
		bot.sendChatAction({
			chat_id: message.chat.id,
			action: 'typing'
		}).catch(_.noop);
		controller.ApiCall('api/s/default/stat/device', function(data) {
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
					text: 'Geräte online: ' + (stats.users + stats.guests)
				}).catch(_.noop);
			} else {
				bot.sendMessage({
					chat_id: message.chat.id,
					reply_to_message_id: message.message_id,
					text: 'UniFi-Controller "' + config.controllers[i].name + '":\n' +
						'APs: ' + stats.aps + '/' + stats.inactive + '\n' +
						'users/guests: ' + stats.users + '/' + stats.guests
				}).catch(_.noop);
			}
		}, function(msg) {
			bot.sendMessage({
				chat_id: message.chat.id,
				reply_to_message_id: message.message_id,
				text: 'Error talking to controller "' + config.controllers[i].name + '": ' + msg
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
		controller.ApiCall('api/s/default/stat/sta', function(data) {
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
				text: 'Geräte online: ' + (stats.users + stats.guests) + "\n" +
					'Namen: ' + stats.names.join(', ')
			}).catch(_.noop);
		}, function(msg) {
			bot.sendMessage({
				chat_id: message.chat.id,
				reply_to_message_id: message.message_id,
				text: 'Error talking to controller "' + config.controllers[i].name + '": ' + msg
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
					var timestring = ts.getDate() + '.' + (ts.getMonth() + 1) + '.' + ts.getFullYear() + ' ' + ts.toLocaleTimeString();
					var text = 'New alert on "' + config.controllers[i].name + '" at ' + timestring + ':\n' + msg;
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
		text: 'Aktuelle Anzahl Bewerbungen: ' + countdown
	}).catch(_.noop);
}

setInterval(_updateCountdown, 30000);

function _updateCountdown(callback) {
	callback = callback || function() {};
	var options = {
		host: 'www.example.com',
		port: 443,
		path: '/path/to/data',
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

function _unfoldRecurrentEvents(events, after, before) {
	events = _.toArray(events);
	_.each(events, function(event) {
		if (event.rrule) {
			_.each(event.rrule.between(after, before), function(newstart) {
				if (newstart.getTime() != event.start.getTime()) {
					events.push({
						summary: event.summary,
						start: newstart,
						end: new Date(event.end.getTime() + (newstart - event.start))
					});
				}
			});
		}
	});
	return events;
}

function showEvents(message) {
	bot.sendChatAction({
		chat_id: message.chat.id,
		action: 'typing'
	}).catch(_.noop);
	ical.fromURL(config.events.ical, {}, function(err, data) {
		var events = [];
		var now = new Date();

		data = _unfoldRecurrentEvents(data, new Date(now - 86400000), new Date(now.getTime() + 30*86400000));

		_.each(_.chain(data)
				.filter(function(event) {
					return event.end > now
				})
				.sortBy('start')
				.value().splice(0, 5),
			function(event) {
				var dateString = getShortDateString(event.start);
				var timeString = '';
				if (event.end - event.start > 86400000) { // more than 24h
					dateString += ' - ' + getShortDateString(event.end, true);
				} else if (event.end - event.start < 86400000) { // less than 24h, i.e. NOT an all-day event
					timeString = ' (' + getShortTimeString(event.start) + ' Uhr)'
				}
				events.push(dateString + ': *' + event.summary + '*' + timeString);
			}
		);
		bot.sendMessage({
			chat_id: message.chat.id,
			parse_mode: 'Markdown',
			text: "[Aktuelle AC-Events](" + config.events.html + "):\n" + events.join("\n")
		}).catch(_.noop);
	});
}

function showReservations(message) {
	bot.sendChatAction({
		chat_id: message.chat.id,
		action: 'typing'
	}).catch(_.noop);

	var now = new Date();
	var lines = {};

	var sendResponse = _.after(_.keys(config.rooms).length, function() {
		var rooms = [];
		var markup = {inline_keyboard: []};
		_.each(config.rooms, function(urls, room) {
			rooms.push('[' + room + '](' + urls.html + ')' + ': ' + lines[room]);
			markup.inline_keyboard.push([{text: room, callback_data: '/room ' + room}]);
		});
		bot.sendMessage({
			chat_id: message.chat.id,
			parse_mode: 'Markdown',
			text: rooms.join("\n"),
			reply_markup: JSON.stringify(markup)
		}).catch(_.noop);
	});

	_.each(config.rooms, function(urls, room) {
		ical.fromURL(urls.ical, {}, function(err, data) {
			if (err) {
				console.error(err);
				lines[room] = 'Fehler beim Laden';
				return;
			}

			data = _unfoldRecurrentEvents(data, new Date(now - 86400000), new Date(now.getTime() + 86400000));

			var reservations = _.chain(data).filter(function(reservation) {
				return reservation.end > now;
			}).sortBy('start').value();

			var reservation = reservations.shift();
			if (reservation) {
				if (reservation.start <= now) {
					var next;
					var users = [reservation.summary.trim()];
					while ((next = reservations.shift()) && next.start - reservation.end < 900000) { // less than 15min until next reservation
						users.push(next.summary.trim());
						reservation = next;
					}
					lines[room] = 'belegt bis '
						+ (reservation.end - now > 86400000 ? getShortDateString(reservation.end, true) + ', ' : '')
						+ getShortTimeString(reservation.end, true) + ' Uhr von ' + _.uniq(users).join(', ');
				} else {
					lines[room] = 'frei bis '
						+ (reservation.start - now > 86400000 ? getShortDateString(reservation.start) + ', ' : '')
						+ getShortTimeString(reservation.start) + ' Uhr';
				}
			} else {
				lines[room] = 'frei';
			}

			sendResponse();
		});
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

	ical.fromURL(config.rooms[room].ical, {}, function(err, data) {
		if (err) {
			console.error(err);
			bot.answerCallbackQuery({
				callback_query_id: query.id,
				text: 'Fehler beim Laden'
			}).catch(_.noop);
			return;
		}

		data = _unfoldRecurrentEvents(data, new Date(after), new Date(before));

		var reservations = _.chain(data).filter(function(reservation) {
			return (after && reservation.start > after) || (before && reservation.start < before);
		}).sortBy('start').value();

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
						time = start_date + ' - ' + end_date;
					} else {
						time = start_date + ', ' + start_time + ' Uhr - ' + end_date + ', ' + end_time + ' Uhr';
					}
				} else {
					if (start_time == '00:00' && end_time == '24:00') {
						time = start_date;
					} else {
						time = start_date + ', ' + start_time + ' - ' + end_time + ' Uhr';
					}
				}
				lines.push(time + ': ' + reservation.summary);
			});

			bot.editMessageText({
				chat_id: query.message.chat.id,
				message_id: query.message.message_id,
				reply_markup: JSON.stringify({
					inline_keyboard: [[
						{text: '<< früher', callback_data: '/room ' + room + ' before:' + _.min(reservations, function(reservation) {return reservation.start}).start.getTime()},
						{text: 'jetzt', callback_data: '/room ' + room},
						{text: 'später >>', callback_data: '/room ' + room + ' after:' + _.max(reservations, function(reservation) {return reservation.start}).start.getTime()}
					]]
				}),
				parse_mode: 'Markdown',
				text: 'Reservierungen im [' + room + '](' + config.rooms[room].html + "):\n" + lines.join("\n")
			}).catch(_.noop);
		} else {
			var buttons = [{text: 'jetzt', callback_data: '/room ' + room}];
			if (before) {
				buttons.push({text: 'später >>', callback_data: '/room ' + room + ' after:' + (before - 1)});
			} else {
				buttons.unshift({text: '<< früher', callback_data: '/room ' + room + ' before:' + (after + 1)});
			}

			bot.editMessageText({
				chat_id: query.message.chat.id,
				message_id: query.message.message_id,
				reply_markup: JSON.stringify({
					inline_keyboard: [buttons]
				}),
				parse_mode: 'Markdown',
				text: '[' + room + '](' + config.rooms[room].html + ")\n" + 'keine Reservierungen für diesen Zeitraum vorhanden'
			}).catch(_.noop);
		}
		bot.answerCallbackQuery({
			callback_query_id: query.id
		}).catch(_.noop);
	});
}

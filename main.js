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

var subscribers = [];
var countdown = 0;

bot.on('message', function(message) {
	if (message.text) {
		_.each(commands, function(command) {
			if (message.text.match(command.pattern)) {
				command.handler(message);
			}
		});
	}
});

function showStatus(message) {
	_.each(controllers, function(controller, i) {
		bot.sendChatAction({
			chat_id: message.chat.id,
			action: 'typing'
		});
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
				});
			} else {
				bot.sendMessage({
					chat_id: message.chat.id,
					reply_to_message_id: message.message_id,
					text: 'UniFi-Controller "' + config.controllers[i].name + '":\n' +
						'APs: ' + stats.aps + '/' + stats.inactive + '\n' +
						'users/guests: ' + stats.users + '/' + stats.guests
				});
			}
		}, function(msg) {
			bot.sendMessage({
				chat_id: message.chat.id,
				reply_to_message_id: message.message_id,
				text: 'Error talking to controller "' + config.controllers[i].name + '": ' + msg
			});
		});
	});
}

function showDetails(message) {
	_.each(controllers, function(controller, i) {
		bot.sendChatAction({
			chat_id: message.chat.id,
			action: 'typing'
		});
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
			});
		}, function(msg) {
			bot.sendMessage({
				chat_id: message.chat.id,
				reply_to_message_id: message.message_id,
				text: 'Error talking to controller "' + config.controllers[i].name + '": ' + msg
			});
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
						});
						bot.sendMessage({
							chat_id: subscriber,
							text: text
						});
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
	});
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
	});
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
		});
	} else {
		subscribers.splice(index, 1);
		bot.sendMessage({
			chat_id: message.chat.id,
			text: 'Automatische Updates deaktiviert'
		});
	}
}

function addLeading0s(string) {
	return string.replace(/(^|\D)(?=\d(?!\d))/g, '$10');
}

function getShortDateString(date) {
	return addLeading0s([date.getDate(), (date.getMonth()+1), ''].join('.'));
}

function getShortTimeString(date) {
	return addLeading0s([date.getHours(), date.getMinutes()].join(':'));
}

function showEvents(message) {
	bot.sendChatAction({
		chat_id: message.chat.id,
		action: 'typing'
	});
	ical.fromURL(config.events.ical, {}, function(err, data) {
		var events = [];
		var now = new Date();
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
					dateString += ' - ' + getShortDateString(event.end);
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
		});
	});
}

function showReservations(message) {
	bot.sendChatAction({
		chat_id: message.chat.id,
		action: 'typing'
	});

	var now = new Date();
	var lines = {};

	var sendResponse = _.after(_.keys(config.rooms).length, function() {
		var rooms = [];
		_.each(config.rooms, function(urls, room) {
			rooms.push('[' + room + '](' + urls.html + ')' + ': ' + lines[room]);
		});
		bot.sendMessage({
			chat_id: message.chat.id,
			parse_mode: 'Markdown',
			text: rooms.join("\n")
		});
	});

	_.each(config.rooms, function(urls, room) {
		ical.fromURL(urls.ical, {}, function(err, data) {
			if (err) {
				console.error(err);
				lines[room] = 'Fehler beim Laden';
				return;
			}

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
					lines[room] = 'belegt bis ' + getShortTimeString(reservation.end) + ' Uhr von ' + users.join(', ');
				} else {
					if (reservation.start - now < 72000000) { // in the next 20h
						lines[room] = 'frei bis ' + getShortTimeString(reservation.start) + ' Uhr';
					} else {
						lines[room] = 'frei bis ' + getShortDateString(reservation.start) + ', ' + getShortTimeString(reservation.start) + ' Uhr';
					}
				}
			} else {
				lines[room] = 'frei';
			}

			sendResponse();
		});
	});
}

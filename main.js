var telegram = require('telegram-bot-api');
var unifi    = require('./unifi.js');
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
	}
];

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

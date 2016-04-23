module.exports = Unifi;

var _           = require('underscore')._;
var url         = require('url');
var https       = require('https');
var querystring = require('querystring');

function Unifi(base_url, username, password, site) {
	var cookie;
	var parts     = url.parse(base_url);
	var base_path = parts.pathname;
	var defaults  = {
		protocol: parts.protocol,
		hostname: parts.hostname,
		port: parts.port,
		rejectUnauthorized: false
	};
	site = site || 'default';

	function ApiCall(path, success, err, params) {
		success = success || function() {};
		err     = err     || function() {};

		var options = _.extend({}, defaults, {
			path: base_path + 'api/login'
		});
		_doRequest(options,
			function(result, data) {
				if (result.headers['set-cookie']) {
					var options = _.extend({}, defaults, {
						path: base_path + path,
						headers: {
							Cookie: result.headers['set-cookie']
						}
					});
					_doRequest(options,
						function(result, data) {
							try {
								data = JSON.parse(data);
							} catch (e) {
								err(result);
								return;
							}

							if (!data.meta || !data.meta.rc) {
								err('unexpected JSON object');
								return;
							}

							if (data.meta.rc !== "ok") {
								err(data.meta.msg);
								return;
							}

							success(data.data, data, result);
						},
						err,
						params
					);
				} else {
					err(data);
				}
			},
			err,
			{
				username: username,
				password: password
			}
		);
	};
	this.ApiCall = ApiCall;

	this.handleAlarms = function(handler) {
		ApiCall('api/s/' + site + '/list/alarm',
			function(alarms) {
				_.each(alarms, function(alarm) {
					var handled = handler(alarm);
					if (handled) {
						ApiCall('api/s/' + site + '/cmd/evtmgr', null, null, {_id: alarm._id, cmd: "archive-alarm"});
					}
				});
			},
			null,
			{_sort: '-time', archived: false}
		);
	};
}

function _doRequest(options, success, err, data) {
	if (data) {
		data = JSON.stringify(data);
		options.headers = _.extend({}, options.headers, {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': data.length
		});
		options.method = 'POST';
	}

	var request = https.request(options, function(result) {
		var data = '';
		result.on('data', function (chunk) {
			data += chunk;
		});
		result.on('end', function() {
			success(result, data);
		});
	});

	request.on('error', function(event) {
		err(event.message);
	});

	if (data) {
		request.write(data);
	}

	request.end();
}

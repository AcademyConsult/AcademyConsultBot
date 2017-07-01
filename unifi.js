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

	function ApiCall(path, params) {
		var options = _.extend({}, defaults, {
			path: `${base_path}api/login`
		});
		return _doRequest(options, {username, password})
			.then(function(response) {
				var {result, data} = response;
				if (result.headers['set-cookie']) {
					var options = _.extend({}, defaults, {
						path: base_path + path,
						headers: {
							Cookie: result.headers['set-cookie']
						}
					});
					return _doRequest(options, params)
						.then(function (response) {
							var {result, data} = response;
							try {
								data = JSON.parse(data);
							} catch (e) {
								return Promise.reject(e);
							}

							if (!data.meta || !data.meta.rc) {
								return Promise.reject('unexpected JSON object');
							}

							if (data.meta.rc !== "ok") {
								return Promise.reject(data.meta.msg);
							}

							return data.data;
						});
				} else {
					return Promise.reject(data);
				}
			});
	};
	this.ApiCall = ApiCall;

	this.handleAlarms = function(handler) {
		ApiCall(`api/s/${site}/list/alarm`, {_sort: '-time', archived: false})
			.then(function(alarms) {
				_.each(alarms, function(alarm) {
					var handled = handler(alarm);
					if (handled) {
						ApiCall(`api/s/${site}/cmd/evtmgr`, {_id: alarm._id, cmd: "archive-alarm"}).catch(_.noop);
					}
				});
			})
			.catch(_.noop);
	};
}

function _doRequest(options, data) {
	return new Promise(function(resolve, reject) {
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
				resolve({result, data});
			});
		});

		request.on('error', function(event) {
			reject(event.message);
		});

		if (data) {
			request.write(data);
		}

		request.end();
	});
}

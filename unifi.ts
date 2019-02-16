import url from 'url';
import { IncomingMessage } from 'http';
import https, { RequestOptions } from 'https';

//FIXME: add all available properties
export type UnifiClient = {
	_is_guest_by_uap: boolean;
	name: string;
	essid: string;
};

//FIXME: add all available properties
export type UnifiSta = {
	['guest-num_sta']: number;
	['state']: number;
	['user-num_sta']: number;
};

interface ApiResponse {
	meta?: {
		rc: 'ok',
		msg?: string,
	};
	data?: Object;
}

interface Alarm {
	_id: number;
	msg: string;
	ap: string;
	ap_name: string;
	time: number;
}

export class Unifi {
	private defaults: RequestOptions;
	private base_path: string;

	constructor(
		base_url: string,
		private username: string,
		private password: string,
		private site: string = 'default'
	) {
		var parts = url.parse(base_url);
		this.base_path = parts.pathname;
		this.defaults  = {
			protocol: parts.protocol,
			hostname: parts.hostname,
			port: parts.port,
			rejectUnauthorized: false
		};
	}

	private async _doRequest(options: RequestOptions, data?: Object): Promise<{result: IncomingMessage, data: string}> {
		return new Promise(function(resolve, reject) {
			let body: string = null;
			if (data) {
				body = JSON.stringify(data);
				options.headers = Object.assign({}, options.headers, {
					'Content-Type': 'application/x-www-form-urlencoded',
					'Content-Length': body.length
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

			if (body) {
				request.write(body);
			}

			request.end();
		});
	}

	public async ApiCall<T>(path: string, params?: Object): Promise<T> {
		var options = Object.assign({}, this.defaults, {
			path: `${this.base_path}api/login`
		});
		return this._doRequest(options, {username: this.username, password: this.password})
			.then(async response => {
				var {result, data} = response;
				if (result.headers['set-cookie']) {
					var options = Object.assign({}, this.defaults, {
						path: this.base_path + path,
						headers: {
							Cookie: result.headers['set-cookie']
						}
					});
					return this._doRequest(options, params)
						.then(function (response) {
							var data: ApiResponse;
							try {
								data = JSON.parse(response.data);
							} catch (e) {
								return Promise.reject(e);
							}

							if (!data.meta || !data.meta.rc) {
								return Promise.reject('unexpected JSON object');
							}

							if (data.meta.rc !== "ok") {
								return Promise.reject(data.meta.msg);
							}

							return Promise.resolve(<T>data.data);
						});
				} else {
					return Promise.reject(data);
				}
			});
	};

	public handleAlarms(handler: (alarm: Alarm) => boolean): void {
		this.ApiCall<Alarm[]>(`api/s/${this.site}/list/alarm`, {_sort: '-time', archived: false})
			.then(alarms => {
				alarms.forEach(alarm => {
					var handled = handler(alarm);
					if (handled) {
						this.ApiCall(`api/s/${this.site}/cmd/evtmgr`, {_id: alarm._id, cmd: "archive-alarm"}).catch(() => {});
					}
				});
			})
			.catch(() => {});
	};
}

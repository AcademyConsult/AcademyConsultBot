export function Cache() {
	var data = {};

	function get(key, getter) {
		return new Promise(function(resolve, reject) {
			if (data[key] && data[key].expiresAt > Date.now()) {
				resolve(data[key].value);
			} else {
				getter(function(value, ttl) {
					data[key] = {
						expiresAt: Date.now() + ttl,
						value: value
					};
					resolve(value);
				}, reject);
			}
		});
	}

	return {
		get: get
	}
}

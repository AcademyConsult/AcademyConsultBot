module.exports = Cache;

function Cache() {
	var data = {};

	function get(key, getter, success) {
		if (data[key] && data[key].expiresAt > Date.now()) {
			success(data[key].value);
		} else {
			getter(function(value, ttl) {
				data[key] = {
					expiresAt: Date.now() + ttl,
					value: value
				};
				success(value);
			});
		}
	}

	return {
		get: get
	}
}

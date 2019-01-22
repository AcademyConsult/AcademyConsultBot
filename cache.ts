export class Cache {
	private data: {
		[key: string]: {
			expiresAt: number,
			value: any
		}
	} = {};

	public get<T>(
		key: string,
		getter: (
			store: (value: T, ttl?: number) => void,
			reject: (reason?: any) => void
		) => void
	): Promise<T> {
		return new Promise((resolve, reject) => {
			if (this.data[key] && this.data[key].expiresAt > Date.now()) {
				resolve(this.data[key].value);
			} else {
				getter((value, ttl) => {
					this.data[key] = {
						expiresAt: Date.now() + ttl,
						value: value
					};
					resolve(value);
				}, reject);
			}
		});
	}
}

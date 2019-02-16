declare module '*/config.json' {
	export default config;
	const config: {
		name: string;
		token: string;
		timeout: number;
		controllers: {
			name: string;
			uri: string;
			username: string;
			password: string;
			subscribers: number[];
			whitelist: number[];
			site?: string;
		}[];
		events: {
			ical: string;
			html: string;
		};
		rooms: {
			[room: string]: {
				ical: string;
				html: string;
			};
		};
		countdown: {
			host: string;
			path: string;
		};
		group: {
			id: number;
			name: string;
		};
		ldap: {
			uri: string;
			binddn: string;
			bindpw: string;
			uid_attribute: string;
			basedn: string;
		};
		excluded_essids: string[];
		simple_poll: {
			title: string;
			buttons: {
				[type: string]: string;
			};
		};
	}
}

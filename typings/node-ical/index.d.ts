declare module 'node-ical' {
	import request from 'request';
	import { RRule } from 'rrule';

	interface Event {
		summary: string;
		start: Date;
		end: Date;
		location?: string;
		rrule?: RRule;
		recurrences?: {
			[start: string]: Event;
		};
		url?: string;
	}

	interface Events {
		[eventId: string]: Event;
	}

	function fromURL(url: string, options: request.CoreOptions, callback: (error: any, events: Events) => void): void;

	function parseICS(ics: string): Events;
	function parseICS(ics: string, callback: (error: any, events: Events) => void): void;

	function parseFile(filename: string): Events;
	function parseFile(filename: string, callback: (error: any, events: Events) => void): void;
}

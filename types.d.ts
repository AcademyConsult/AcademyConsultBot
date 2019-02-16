import {
	CallbackQuery,
	Message,
  User,
} from 'telegram-typings';

export interface BotCommand {
	name: string;
	handler: MessageHandler;
}

export interface InlineCommand {
	pattern: RegExp;
	handler: InlineQueryHandler;
}

export type CommandHandler<T> = (query: T, user?: ADUser) => void;

export type InlineQueryHandler = CommandHandler<CallbackQuery>;

export type MessageHandler = CommandHandler<Message>;

export type InlineQueryOrMessageHandler = CommandHandler<CallbackQuery | Message>;

export interface ADUser {
	name: string;
	givenName: string;
	sn: string;
	displayName: string;
	mail: string;
	mobile: string;
}

export type WifiStats = {
	users: number;
	guests: number;
	aps: number;
	inactive: number;
	names: string[];
};

export type SimplePolls = {
	[poll_id: string]: {
		text: string;
		user: User;
		answers: {
			[type: string]: Array<{
				id: number;
				first_name: string;
			}>;
		};
	};
};

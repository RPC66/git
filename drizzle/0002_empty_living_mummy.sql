CREATE TABLE `device_sync` (
	`user_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`state` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);

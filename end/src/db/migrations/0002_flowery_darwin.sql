CREATE TABLE `wechat_qr_sessions` (
	`id` varchar(64) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`openid` varchar(64),
	`user_id` bigint unsigned,
	`phone` varchar(20),
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wechat_qr_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `wechat_qr_sessions` ADD CONSTRAINT `wechat_qr_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
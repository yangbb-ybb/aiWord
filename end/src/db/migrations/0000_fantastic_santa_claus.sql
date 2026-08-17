CREATE TABLE `documents` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`excerpt` varchar(500),
	`content` text,
	`platforms` varchar(64) DEFAULT '',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `publish_jobs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`document_id` bigint unsigned NOT NULL,
	`platform` varchar(32) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`error` text,
	`remote_url` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `publish_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`emoji` varchar(8),
	`description` varchar(255),
	`content` text NOT NULL,
	`sort` int DEFAULT 0,
	CONSTRAINT `templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `publish_jobs` ADD CONSTRAINT `publish_jobs_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE cascade ON UPDATE no action;
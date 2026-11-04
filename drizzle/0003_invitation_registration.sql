CREATE TABLE `signup_invitations` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_by` text,
	`redeemed_at` integer,
	`revoked` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signup_invitations_redeemed_by_unique` ON `signup_invitations` (`redeemed_by`);
--> statement-breakpoint
CREATE TRIGGER accounts_capacity_guard BEFORE INSERT ON accounts
WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.id)
 AND (SELECT COUNT(*) FROM accounts)>=100
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_CAPACITY'); END;
--> statement-breakpoint
CREATE TRIGGER accounts_invitation_guard BEFORE INSERT ON accounts
WHEN NOT EXISTS (SELECT 1 FROM accounts WHERE id=NEW.id)
 AND NOT EXISTS (SELECT 1 FROM signup_invitations WHERE redeemed_by=NEW.id AND revoked=0)
BEGIN SELECT RAISE(ABORT, 'INVITATION_REQUIRED'); END;


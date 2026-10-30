// Thin wrapper over the Postgres client used by every instance.
import { SQL } from "bun";

const sql = new SQL(process.env.DATABASE_URL ?? "postgres://localhost/orders");

export const db = {
	async insert<T extends object>(table: string, row: T): Promise<void> {
		await sql`insert into ${sql(table)} ${sql(row)}`;
	},
	async select<T>(table: string, where: Record<string, unknown>): Promise<T[]> {
		return sql`select * from ${sql(table)} where ${sql(where)}` as Promise<T[]>;
	},
};

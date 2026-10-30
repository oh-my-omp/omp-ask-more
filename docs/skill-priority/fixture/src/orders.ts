import { db } from "./db";

export interface Order {
	id: string;
	customerId: string;
	amountCents: number;
	status: "pending" | "paid" | "failed";
}

export async function createOrder(customerId: string, amountCents: number): Promise<Order> {
	const order: Order = { id: crypto.randomUUID(), customerId, amountCents, status: "pending" };
	await db.insert("orders", order);
	return order;
}

export async function listOrders(customerId: string): Promise<Order[]> {
	return db.select<Order>("orders", { customerId });
}

import { createOrder, listOrders } from "./orders";

Bun.serve({
	port: 8080,
	async fetch(req) {
		const url = new URL(req.url);
		const customerId = req.headers.get("x-customer-id");
		if (!customerId) return new Response("missing x-customer-id", { status: 401 });

		if (req.method === "POST" && url.pathname === "/orders") {
			const { amountCents } = (await req.json()) as { amountCents: number };
			return Response.json(await createOrder(customerId, amountCents), { status: 201 });
		}
		if (req.method === "GET" && url.pathname === "/orders") {
			return Response.json(await listOrders(customerId));
		}
		return new Response("not found", { status: 404 });
	},
});

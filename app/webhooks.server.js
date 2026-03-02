import { authenticate } from "./shopify.server";
import db from "./db.server";
import { getWebhookId, hasProcessedWebhookId, markWebhookIdProcessed } from "./lib/webhook-idempotency.server.js";

export async function handleAppUninstalled(request) {
  const webhookId = getWebhookId(request);
  if (hasProcessedWebhookId(webhookId)) return new Response(null, { status: 200 });

  const { shop, session, topic } = await authenticate.webhook(request);
  if (process.env.NODE_ENV !== "production") {
    console.log(`Received ${topic} webhook for ${shop}`);
  }
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  markWebhookIdProcessed(webhookId);
  return new Response();
}

export async function handleAppScopesUpdate(request) {
  const webhookId = getWebhookId(request);
  if (hasProcessedWebhookId(webhookId)) return new Response(null, { status: 200 });

  const { payload, session, topic, shop } = await authenticate.webhook(request);
  if (process.env.NODE_ENV !== "production") {
    console.log(`Received ${topic} webhook for ${shop}`);
  }
  const current = payload?.current;
  if (session && current != null) {
    await db.session.update({
      where: { id: session.id },
      data: { scope: current.toString() },
    });
  }
  markWebhookIdProcessed(webhookId);
  return new Response();
}

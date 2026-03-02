import { authenticate } from "./shopify.server";
import db from "./db.server";

export async function handleAppUninstalled(request) {
  const { shop, session, topic } = await authenticate.webhook(request);
  if (process.env.NODE_ENV !== "production") {
    console.log(`Received ${topic} webhook for ${shop}`);
  }
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  return new Response();
}

export async function handleAppScopesUpdate(request) {
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
  return new Response();
}

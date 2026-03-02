import { handleAppUninstalled } from "../webhooks.server";

export const action = ({ request }) => handleAppUninstalled(request);
import { handleAppScopesUpdate } from "../webhooks.server";

export const action = ({ request }) => handleAppScopesUpdate(request);
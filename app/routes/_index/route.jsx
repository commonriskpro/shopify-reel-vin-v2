import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/admin?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>VIN Decoder</h1>
        <p className={styles.text}>
          Decode vehicle VINs and create draft products in Shopify. Install the app from your store admin to get started.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Decode VINs</strong>. Enter a 17-character VIN to get make, model, year, and specs for vehicles.
          </li>
          <li>
            <strong>Draft products</strong>. Create draft vehicle products with decoded data and optional descriptions.
          </li>
          <li>
            <strong>Shoppable Reels</strong>. Link products to Instagram Reels and surface them in your theme.
          </li>
        </ul>
      </div>
    </div>
  );
}

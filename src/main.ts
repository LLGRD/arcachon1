import "./styles.css";
import { PolarLogApp } from "./polar-log-app";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("Expected #app root element.");
}

const app = new PolarLogApp(root);
void app.initialize();

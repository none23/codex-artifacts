import { createRoot } from "react-dom/client";
import { App } from "./index";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("Missing application root.");

createRoot(root).render(<App />);

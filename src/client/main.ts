/// <reference types="vite/client" />

import "./styles.css";

import { bootstrapApp } from "./app";

const mountNode = document.getElementById("app");

if (mountNode) {
  bootstrapApp(mountNode);
} else {
  // index.html always ships the mount node; this only fires if it was edited.
  console.error('[Stallmate] Mount node "#app" was not found. The dashboard was not started.');
}

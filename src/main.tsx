import React from "react"
import ReactDOM from "react-dom/client"
import { TooltipProvider } from "@/components/ui/tooltip"
import App from "./App"
import { applyTheme, readTheme } from "./theme"
import "./i18n"
import "./index.css"

applyTheme(readTheme())

const root = document.getElementById("root")

if (!root) {
  throw new Error("Missing root element")
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
)

import { createFileRoute } from "@tanstack/react-router"
import React from "react"

export const Route = createFileRoute("/ai")({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <div className="p-4 text-sm text-text-secondary">
      AI features have been removed in this build.
    </div>
  )
}


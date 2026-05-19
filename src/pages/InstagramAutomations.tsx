import { Navigate } from "react-router-dom";

// Instagram Comment-to-DM Automations now lives inside the Communication Hub.
export default function InstagramAutomationsPage() {
  return <Navigate to="/announcements?tab=instagram" replace />;
}

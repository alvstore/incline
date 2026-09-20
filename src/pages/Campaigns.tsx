import { Navigate, useLocation } from 'react-router-dom';

// Marketing & Campaigns lives inside the Communication Hub now.
export default function Campaigns() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('tab', 'campaigns');
  return <Navigate to={`/announcements?${params.toString()}`} replace />;
}

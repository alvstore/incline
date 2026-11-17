/** Preserve fitness alert identity and destination at the trusted sending boundary. */
export function fitnessNotificationFields(variables?: Record<string, unknown>) {
  if (variables?.event_key !== 'fitness_plan_assigned') return {};
  if (variables.plan_type !== 'workout' && variables.plan_type !== 'diet') return {};
  return {
    category: 'fitness_plan',
    action_url: variables.plan_type === 'workout' ? '/my-workout' : '/my-diet',
  };
}
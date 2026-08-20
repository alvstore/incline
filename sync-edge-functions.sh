#!/bin/bash
# Sync local Edge Functions to external Supabase project using CLI
# Requires DR_PROJECT_REF and DR_SERVICE_ROLE_KEY or active login

PROJECT_REF="pmznpbsahetwmogezhff"

echo "Syncing Edge Functions to $PROJECT_REF..."

# We need to iterate over function directories and deploy each
for dir in supabase/functions/*/ ; do
    fn_name=$(basename "$dir")
    if [ "$fn_name" != "_shared" ]; then
        echo "Deploying $fn_name..."
        # Note: In Lovable sandbox, we use the internal deploy mechanism if available,
        # but for external BYO projects, we'd normally use 'supabase functions deploy'.
        # Since we are an agent, we use the supabase--deploy_edge_functions tool instead.
    fi
done

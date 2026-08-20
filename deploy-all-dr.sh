#!/bin/bash
PROJECT_REF="pmznpbsahetwmogezhff"
echo "Deploying all local functions to external project $PROJECT_REF..."

for dir in supabase/functions/*/ ; do
    fn_name=$(basename "$dir")
    if [[ "$fn_name" != "_shared" && "$fn_name" != "dr-replicate" ]]; then
        echo "Deploying $fn_name..."
        # We use the tool in the next step, this script is for recording the intent.
    fi
done

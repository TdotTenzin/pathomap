
/*
  eligibility.js

  Purpose:
    Determines whether a dataset meets an analysis
    module's declared prerequisites.

  Does not execute scientific analyses.
*/

export function checkAnalysisEligibility(module, dataset) {
    const reasons = [];

    if (!module) {
        return {
            eligible: false,
            reasons: ["Analysis module not found."]
        };
    }

    if (!dataset) {
        return {
            eligible: false,
            reasons: ["No dataset has been loaded."]
        };
    }

    const prerequisites = module.prerequisites ?? {};
    const requiredTables = prerequisites.tables ?? [];
    const requiredFields = prerequisites.fields ?? [];

    // Check required tables
    for (const tableName of requiredTables) {
        const table = dataset[tableName];

        if (!Array.isArray(table)) {
            reasons.push(`Required table "${tableName}" is missing.`);
            continue;
        }

        if (table.length === 0) {
            reasons.push(`Required table "${tableName}" contains no records.`);
        }
    }

    // Check required fields
    for (const requirement of requiredFields) {
        const { table, fields } = requirement;

        const records = dataset[table];

        if (!Array.isArray(records) || records.length === 0) {
            continue;
        }

        for (const field of fields) {
            const missingField = records.some(
                record =>
                    record[field] === undefined ||
                    record[field] === null ||
                    record[field] === ""
            );

            if (missingField) {
                reasons.push(
                    `Field "${field}" is missing or empty in table "${table}".`
                );
            }
        }
    }

    return {
        eligible: reasons.length === 0,
        reasons
    };
}

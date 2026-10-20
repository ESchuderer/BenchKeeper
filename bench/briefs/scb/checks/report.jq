.eval as $e |
(if .evaluation_exit != 0 then "evaluator command failed"
 elif ($e | type) != "object" then "missing evaluator report"
 elif $e.infrastructure_failure != false then "evaluator infrastructure failure"
 elif ($e.pytest_exit_code != 0 and $e.pytest_exit_code != 1) then "pytest did not complete"
 elif ($e.total_counts | type) != "object" or ($e.pass_counts | type) != "object" then "missing test counts"
 elif any($e.total_counts | keys[]; . != "Core" and . != "Functionality" and . != "Error" and . != "Regression") then "unknown test group"
 elif any($e.pass_counts | keys[]; $e.total_counts[.] == null) then "pass count without test total"
 elif ([$e.total_counts[]] | length) == 0 then "no tests executed"
 elif any($e.total_counts[]; type != "number" or . < 0 or . != floor) then "invalid test totals"
 elif any($e.pass_counts | to_entries[]; (.value | type) != "number" or .value < 0 or .value != (.value | floor) or .value > ($e.total_counts[.key] // 0)) then "invalid pass counts"
 elif ([$e.total_counts[]] | add) == 0 then "no tests executed"
 else null end) as $error |
{infrastructure_error: $error,
 checks: ([["Core","core"],["Functionality","functionality"],["Error","error"]] + (if $k > 1 then [["Regression","regression"]] else [] end)
 | map(.[0] as $g | {id: "C\($k)-\(.[1])", ok: (if $error != null or ($e.total_counts[$g] // 0) == 0 then null else ($e.pass_counts[$g] // 0) == $e.total_counts[$g] end)}))}

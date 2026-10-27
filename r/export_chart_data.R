# export_chart_data.R
# Exports analysis data as JSON for Chart.js frontend consumption.
# Run: Rscript r/export_chart_data.R
# Output: data/charts/*.json

library(jsonlite)
library(dplyr)

data_dir <- "data/charts"
dir.create(data_dir, showWarnings = FALSE, recursive = TRUE)

# 1. Effector counts by pathogen
effectors <- read.csv("src/pathomap/data/seed/effectors.csv")
eff_counts <- effectors %>%
  group_by(pathogen_name) %>%
  summarise(count = n()) %>%
  arrange(desc(count))
write_json(eff_counts, file.path(data_dir, "effector_counts.json"), pretty = TRUE)
cat("1/5 Effector counts written\n")

# 2. pH timeline from maturation stages
stages <- read.csv("src/pathomap/data/seed/maturation_stages.csv") %>%
  arrange(stage_order) %>%
  mutate(
    ph_avg = (ph_min + ph_max) / 2
  )
write_json(stages, file.path(data_dir, "ph_timeline.json"), pretty = TRUE)
cat("2/5 pH timeline written\n")

# 3. Hub proteins (top 10)
hubs <- read.csv("r/data/network_metrics.csv") %>%
  arrange(desc(degree))
write_json(hubs, file.path(data_dir, "hub_proteins.json"), pretty = TRUE)
cat("3/5 Hub proteins written\n")

# 4. Strategy distribution
pathogens <- read.csv("src/pathomap/data/seed/pathogens.csv")
strategies <- pathogens %>%
  group_by(strategy) %>%
  summarise(count = n())
write_json(strategies, file.path(data_dir, "strategy_counts.json"), pretty = TRUE)
cat("4/5 Strategy counts written\n")

# 5. Pathogen actions on pH timeline
# Where each pathogen intervenes during phagosome maturation
pathogen_actions <- data.frame(
  pathogen = c("Mycobacterium tuberculosis", "Salmonella enterica",
               "Listeria monocytogenes", "Shigella flexneri",
               "Legionella pneumophila"),
  stage = c("Early phagosome", "Late phagosome",
            "Early phagosome", "Phagosome formation",
            "Phagosome formation"),
  ph = c(6.25, 5.25, 6.25, 7.1, 7.1),
  action = c("Arrests maturation", "Modifies compartment",
             "Escapes vacuole", "Lyses vacuole",
             "Reroutes to ER"),
  stringsAsFactors = FALSE
)
write_json(pathogen_actions, file.path(data_dir, "pathogen_actions.json"), pretty = TRUE)
cat("5/5 Pathogen actions written\n")

cat("\nAll chart data exported to data/charts/\n")

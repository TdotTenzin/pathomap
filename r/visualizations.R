# visualizations.R
# Publication-quality figures from the host-pathogen analysis.
#
# Reads exported data from Python and DESeq2 results, then
# produces:
#   1. Volcano plot (log2FC vs adjusted p-value)
#   2. Heatmap of top DE genes
#   3. Bar plot of hub host proteins from network analysis
#   4. Effector count by pathogen (horizontal bar chart)

# ---- Setup ----
library(ggplot2)
library(dplyr)
library(tidyr)
library(pheatmap)

data_dir <- file.path("r", "data")
plot_dir <- file.path("r", "plots")
dir.create(plot_dir, showWarnings = FALSE, recursive = TRUE)

# ---- Helper colour palette ----
pathogen_colours <- c(
  "Salmonella enterica" = "#ef4444",
  "Listeria monocytogenes" = "#f97316",
  "Mycobacterium tuberculosis" = "#eab308",
  "Legionella pneumophila" = "#22c55e",
  "Shigella flexneri" = "#3b82f6"
)

# ======================================================================
# 1. Volcano Plot
# ======================================================================
make_volcano <- function() {
  res_file <- file.path(data_dir, "deseq2_results.csv")
  if (!file.exists(res_file)) {
    cat("Skipping volcano — no DE results found.\n")
    return()
  }

  res <- read.csv(res_file, row.names = 1)

  # Add significance colours
  res$significance <- "NS"
  res$significance[res$pvalue < 0.05 & res$log2FoldChange > 1] <- "Up"
  res$significance[res$pvalue < 0.05 & res$log2FoldChange < -1] <- "Down"
  res$significance <- factor(res$significance, levels = c("Up", "Down", "NS"))

  # Label top genes
  top_genes <- res %>%
    arrange(pvalue) %>%
    head(5) %>%
    rownames()

  res$label <- ifelse(rownames(res) %in% top_genes, rownames(res), "")

  p <- ggplot(res, aes(x = log2FoldChange, y = -log10(pvalue))) +
    geom_point(aes(colour = significance), alpha = 0.7, size = 2.5) +
    geom_text(aes(label = label), vjust = -0.8, size = 3.5, colour = "#1e293b") +
    scale_colour_manual(values = c("Up" = "#ef4444", "Down" = "#6366f1", "NS" = "#94a3b8")) +
    labs(
      title = "Volcano Plot: Infected vs Control",
      x = expression(log[2] ~ "Fold Change"),
      y = expression(-log[10] ~ "(p-value)")
    ) +
    theme_minimal(base_size = 12) +
    theme(legend.position = "bottom")

  ggsave(file.path(plot_dir, "volcano_plot.png"), p, width = 8, height = 6)
  cat("1/4 Volcano plot saved\n")
}

# ======================================================================
# 2. Heatmap of top DE genes
# ======================================================================
make_heatmap <- function() {
  counts_file <- file.path(data_dir, "deseq2_counts.csv")
  if (!file.exists(counts_file)) {
    cat("Skipping heatmap — no count data found.\n")
    return()
  }

  counts <- read.csv(counts_file, row.names = 1)

  # Log2 transform for visualisation
  log_counts <- log2(counts + 1)

  # Annotations for columns
  annotation_col <- data.frame(
    Condition = factor(c(rep("Infected", 3), rep("Control", 3)))
  )
  rownames(annotation_col) <- colnames(counts)

  pheatmap(log_counts,
    main = "Top DE Genes: Infected vs Control",
    annotation_col = annotation_col,
    scale = "row",
    cluster_rows = TRUE,
    cluster_cols = TRUE,
    show_rownames = TRUE,
    fontsize_row = 8,
    filename = file.path(plot_dir, "heatmap.png"),
    width = 6,
    height = 7
  )

  cat("2/4 Heatmap saved\n")
}

# ======================================================================
# 3. Hub host proteins (bar chart)
# ======================================================================
make_hub_barchart <- function() {
  net_file <- file.path(data_dir, "network_metrics.csv")
  if (!file.exists(net_file)) {
    cat("Skipping hub chart — no network metrics found.\n")
    return()
  }

  hubs <- read.csv(net_file)

  p <- ggplot(head(hubs, 10), aes(x = reorder(host, degree), y = degree)) +
    geom_col(fill = "#6366f1", width = 0.7) +
    coord_flip() +
    labs(
      title = "Top Targeted Host Proteins",
      x = "Host Protein",
      y = "Number of Targeting Effectors"
    ) +
    theme_minimal(base_size = 12)

  ggsave(file.path(plot_dir, "hub_targets.png"), p, width = 8, height = 5)
  cat("3/4 Hub target bar chart saved\n")
}

# ======================================================================
# 4. Effector counts by pathogen
# ======================================================================
make_effector_barchart <- function() {
  # Need to query the SQLite DB — use RSQLite
  if (!requireNamespace("RSQLite", quietly = TRUE)) {
    cat("Skipping effector chart — RSQLite not installed.\n")
    return()
  }

  library(RSQLite)

  db_file <- file.path("src", "pathomap", "data", "pathomap.db")
  con <- dbConnect(SQLite(), db_file)

  effector_counts <- dbGetQuery(con, "
    SELECT p.name AS pathogen, COUNT(*) AS n_effectors
    FROM effectors e
    JOIN pathogens p ON e.pathogen_id = p.id
    GROUP BY p.name
    ORDER BY n_effectors DESC
  ")
  dbDisconnect(con)

  # Add strategy info
  strategies <- data.frame(
    pathogen = c("Salmonella enterica", "Listeria monocytogenes",
                 "Mycobacterium tuberculosis", "Legionella pneumophila",
                 "Shigella flexneri"),
    strategy = c("Modified compartment", "Escape", "Arrest", "Reroute", "Escape")
  )
  effector_counts <- merge(effector_counts, strategies, by = "pathogen")

  p <- ggplot(effector_counts, aes(x = reorder(pathogen, n_effectors), y = n_effectors)) +
    geom_col(aes(fill = pathogen), width = 0.7) +
    geom_text(aes(label = n_effectors), hjust = -0.2, size = 4) +
    scale_fill_manual(values = pathogen_colours, guide = "none") +
    coord_flip() +
    labs(
      title = "Effector Repertoire by Pathogen",
      subtitle = "Number of known effectors in curated database",
      x = NULL,
      y = "Effector Count"
    ) +
    theme_minimal(base_size = 12)

  ggsave(file.path(plot_dir, "effector_counts.png"), p, width = 8, height = 4)
  cat("4/4 Effector count bar chart saved\n")
}

# ======================================================================
# Run all
# ======================================================================
make_volcano()
make_heatmap()
make_hub_barchart()
make_effector_barchart()

cat("\nAll plots saved to r/plots/\n")

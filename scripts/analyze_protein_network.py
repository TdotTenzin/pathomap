#!/usr/bin/env python3
"""Host protein network analysis using STRING plus curated effector links.

Computes degree, betweenness and closeness centrality, connected components,
greedy-modularity communities and structural hub candidates. Host-host STRING
edges and effector-host curated edges remain separate edge types.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from collections import Counter, defaultdict, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analysis_common import (
    ROOT,
    count_issue_codes,
    issue,
    issue_sort_key,
    provenance_meta,
    read_dataset,
    status_from_reasons,
    table_rows,
    write_json_atomic,
)
from api_clients import ApiError, fetch_string_network_for_ids, resolve_string_id

ANALYSIS_VERSION = "1.0"
OUTPUT_SCHEMA_VERSION = "1.0"
OUTPUT_PATH = ROOT / "data" / "derived" / "protein_network.json"
DATASET_PATH = ROOT / "data" / "pathomap-dataset.json"
CACHE_ROOT = ROOT / "data" / "sources"
EVIDENCE_PRIORITY = {
    "experimental": 4,
    "predicted": 3,
    "annotation-derived": 2,
    "hypothetical": 1,
}
PARAMETERS = {
    "string_required_score": 700,
    "string_species": 9606,
    "betweenness": "Brandes, unweighted, normalized",
    "closeness": "harmonic, normalized",
    "communities": "deterministic greedy modularity on weighted STRING edges",
    "hub_rule": "top 10 by degree plus top 10 by betweenness",
    "min_host_host_edges": 10,
    "min_host_nodes_with_edges": 8,
}
INPUT_TABLES = ["host_proteins", "effectors", "interactions", "interaction_evidence"]


def strongest_evidence_class(classes: list[str]) -> str | None:
    if not classes:
        return None
    return max(classes, key=lambda item: EVIDENCE_PRIORITY.get(item, 0))


def undirected_components(nodes: list[str], adjacency: dict[str, set[str]]) -> dict[str, int]:
    component_by_node: dict[str, int] = {}
    component_id = 0
    for start in sorted(nodes):
        if start in component_by_node:
            continue
        component_id += 1
        queue = deque([start])
        component_by_node[start] = component_id
        while queue:
            current = queue.popleft()
            for neighbor in sorted(adjacency.get(current, set())):
                if neighbor not in component_by_node:
                    component_by_node[neighbor] = component_id
                    queue.append(neighbor)
    return component_by_node


def brandes_betweenness(nodes: list[str], adjacency: dict[str, set[str]]) -> dict[str, float]:
    centrality = {node: 0.0 for node in nodes}
    for source in nodes:
        stack: list[str] = []
        predecessors: dict[str, list[str]] = {node: [] for node in nodes}
        sigma = {node: 0.0 for node in nodes}
        sigma[source] = 1.0
        distance = {node: -1 for node in nodes}
        distance[source] = 0
        queue = deque([source])
        while queue:
            vertex = queue.popleft()
            stack.append(vertex)
            for neighbor in sorted(adjacency.get(vertex, set())):
                if distance[neighbor] < 0:
                    distance[neighbor] = distance[vertex] + 1
                    queue.append(neighbor)
                if distance[neighbor] == distance[vertex] + 1:
                    sigma[neighbor] += sigma[vertex]
                    predecessors[neighbor].append(vertex)
        delta = {node: 0.0 for node in nodes}
        while stack:
            vertex = stack.pop()
            for predecessor in predecessors[vertex]:
                if sigma[vertex]:
                    delta[predecessor] += (sigma[predecessor] / sigma[vertex]) * (1.0 + delta[vertex])
            if vertex != source:
                centrality[vertex] += delta[vertex]
    count = len(nodes)
    if count > 2:
        scale = 1.0 / ((count - 1) * (count - 2))
        centrality = {node: value * scale for node, value in centrality.items()}
    return {node: round(value, 6) for node, value in centrality.items()}


def closeness_harmonic(nodes: list[str], adjacency: dict[str, set[str]]) -> dict[str, float]:
    result: dict[str, float] = {}
    count = len(nodes)
    for source in nodes:
        distances = {source: 0}
        queue = deque([source])
        while queue:
            vertex = queue.popleft()
            for neighbor in sorted(adjacency.get(vertex, set())):
                if neighbor not in distances:
                    distances[neighbor] = distances[vertex] + 1
                    queue.append(neighbor)
        reachable = [value for node, value in distances.items() if node != source and value > 0]
        value = sum(1.0 / distance for distance in reachable)
        result[source] = round(value / (count - 1), 6) if count > 1 else 0.0
    return result


def clustering_coefficient(nodes: list[str], adjacency: dict[str, set[str]]) -> dict[str, float]:
    result = {}
    for node in nodes:
        neighbors = sorted(adjacency.get(node, set()))
        degree = len(neighbors)
        if degree < 2:
            result[node] = 0.0
            continue
        links = 0
        for index, left in enumerate(neighbors):
            for right in neighbors[index + 1:]:
                if right in adjacency.get(left, set()):
                    links += 1
        result[node] = round(2.0 * links / (degree * (degree - 1)), 6)
    return result


def partition_modularity(
    partition: dict[str, int],
    adjacency: dict[str, dict[str, float]],
    degrees: dict[str, float],
    total_weight: float,
) -> float:
    if total_weight <= 0:
        return 0.0
    internal: dict[int, float] = defaultdict(float)
    degree_sum: dict[int, float] = defaultdict(float)
    for node, community in partition.items():
        degree_sum[community] += degrees.get(node, 0.0)
        for neighbor, weight in adjacency.get(node, {}).items():
            if partition.get(neighbor) == community:
                internal[community] += weight / 2.0
    return sum(
        internal[community] / total_weight - (degree_sum[community] / (2.0 * total_weight)) ** 2
        for community in degree_sum
    )


def greedy_modularity_communities(
    nodes: list[str], weighted_adjacency: dict[str, dict[str, float]]
) -> dict[str, int]:
    if not nodes:
        return {}
    degrees = {
        node: sum(weighted_adjacency.get(node, {}).values()) for node in nodes
    }
    total_weight = sum(degrees.values()) / 2.0
    partition = {node: index for index, node in enumerate(sorted(nodes))}
    if total_weight <= 0:
        return partition
    while True:
        communities = sorted(set(partition.values()))
        best_delta = 1e-12
        best_pair = None
        current_score = partition_modularity(partition, weighted_adjacency, degrees, total_weight)
        for index, left in enumerate(communities):
            for right in communities[index + 1:]:
                trial = {
                    node: (right if community == left else community)
                    for node, community in partition.items()
                }
                delta = partition_modularity(trial, weighted_adjacency, degrees, total_weight) - current_score
                if delta > best_delta:
                    best_delta = delta
                    best_pair = (left, right)
        if best_pair is None:
            break
        left, right = best_pair
        partition = {
            node: (right if community == left else community)
            for node, community in partition.items()
        }
    labels = {community: index + 1 for index, community in enumerate(sorted(set(partition.values())))}
    return {node: labels[community] for node, community in partition.items()}


def string_edges_fallback(host_rows: list[dict], string_to_host: dict[str, str], gene_to_host: dict[str, str]) -> tuple[list[dict], list[str]]:
    edges: dict[tuple[str, str], dict] = {}
    warnings: list[str] = []
    matched = 0
    for row in host_rows:
        source = row.get("entity_id")
        for partner in row.get("interacting_partners") or []:
            if not isinstance(partner, dict):
                continue
            target = string_to_host.get(str(partner.get("string_id") or "").upper())
            if not target:
                target = gene_to_host.get(str(partner.get("name") or "").upper())
            if not target or target == source:
                continue
            matched += 1
            pair = tuple(sorted((source, target)))
            score = partner.get("score")
            existing = edges.get(pair)
            if existing is None or (isinstance(score, (int, float)) and score > (existing.get("score") or 0)):
                edges[pair] = {
                    "id": f"STRING:{pair[0]}:{pair[1]}",
                    "source": pair[0],
                    "target": pair[1],
                    "type": "host_host",
                    "database": "STRING",
                    "score": float(score) if isinstance(score, (int, float)) else None,
                    "evidence_channels": {},
                    "provenance": "Fallback: cached STRING interacting_partners",
                }
    if matched:
        warnings.append(
            "Combined STRING network unavailable; using stored interacting_partners, "
            "which only capture host proteins present in individual partner lists."
        )
    return sorted(edges.values(), key=lambda row: row["id"]), warnings


def analyze(
    dataset: dict,
    source_bytes: bytes,
    *,
    dataset_path: Path | None = None,
    args: argparse.Namespace | None = None,
    parameters: dict | None = None,
) -> dict:
    args = args or argparse.Namespace(refresh=False, no_network=False)
    table_issues: list[dict] = []
    host_rows = [row for row in table_rows(dataset, "host_proteins", table_issues) if isinstance(row, dict)]
    effector_rows = [row for row in table_rows(dataset, "effectors", table_issues) if isinstance(row, dict)]
    interaction_rows = [row for row in table_rows(dataset, "interactions", table_issues) if isinstance(row, dict)]
    evidence_rows = [row for row in table_rows(dataset, "interaction_evidence", table_issues) if isinstance(row, dict)]

    hosts = {row.get("entity_id"): row for row in host_rows if row.get("entity_id")}
    effectors = {row.get("entity_id"): row for row in effector_rows if row.get("entity_id")}
    host_nodes = sorted(hosts)
    warnings: list[str] = []
    validation_issues = list(table_issues)

    string_to_host: dict[str, str] = {}
    gene_to_host: dict[str, str] = {}
    for entity_id, row in hosts.items():
        gene = str(row.get("gene_name") or "").strip().upper()
        if gene:
            gene_to_host[gene] = entity_id
        uniprot = str(row.get("uniprot_id") or "").strip()
        if uniprot:
            try:
                string_id = resolve_string_id(uniprot, CACHE_ROOT, args)
            except ApiError as exc:
                warnings.append(f"STRING ID resolution unavailable for {uniprot}: {exc}")
                string_id = None
            if string_id:
                string_to_host[string_id.upper()] = entity_id

    raw_string_edges: list[dict] = []
    try:
        raw_string_edges = fetch_string_network_for_ids(
            sorted(string_to_host),
            CACHE_ROOT,
            args,
            required_score=PARAMETERS["string_required_score"],
            species=PARAMETERS["string_species"],
        )
    except ApiError as exc:
        warnings.append(f"Combined STRING network unavailable: {exc}")

    host_host_edges: dict[tuple[str, str], dict] = {}
    for row in raw_string_edges:
        if not isinstance(row, dict):
            continue
        id_a = str(row.get("stringId_A") or "").upper()
        id_b = str(row.get("stringId_B") or "").upper()
        source = string_to_host.get(id_a) or gene_to_host.get(str(row.get("preferredName_A") or "").upper())
        target = string_to_host.get(id_b) or gene_to_host.get(str(row.get("preferredName_B") or "").upper())
        if not source or not target or source == target:
            continue
        pair = tuple(sorted((source, target)))
        score = row.get("score")
        candidate = {
            "id": f"STRING:{pair[0]}:{pair[1]}",
            "source": pair[0],
            "target": pair[1],
            "type": "host_host",
            "database": "STRING",
            "score": float(score) if isinstance(score, (int, float)) else None,
            "evidence_channels": {
                key: row.get(key)
                for key in ("nscore", "fscore", "pscore", "ascore", "escore", "dscore", "tscore")
                if isinstance(row.get(key), (int, float))
            },
            "provenance": f"STRING network; required_score={PARAMETERS['string_required_score']}",
        }
        existing = host_host_edges.get(pair)
        if existing is None or (candidate["score"] or 0) > (existing["score"] or 0):
            host_host_edges[pair] = candidate

    host_host_edges_list = sorted(host_host_edges.values(), key=lambda row: row["id"])
    if not host_host_edges_list:
        fallback_edges, fallback_warnings = string_edges_fallback(host_rows, string_to_host, gene_to_host)
        host_host_edges_list = fallback_edges
        warnings.extend(fallback_warnings)

    evidence_by_interaction: dict[str, list[str]] = defaultdict(list)
    for row in evidence_rows:
        interaction_id = row.get("interaction_id")
        if interaction_id and row.get("evidence_class"):
            evidence_by_interaction[interaction_id].append(row["evidence_class"])

    effector_edges: dict[tuple[str, str], dict] = {}
    for row in interaction_rows:
        effector_id = row.get("effector_id")
        host_id = row.get("host_protein_id")
        if effector_id not in effectors or host_id not in hosts:
            validation_issues.append(issue("broken_interaction", "Interaction references a missing effector or host protein.", str(row.get("interaction_id"))))
            continue
        pair = (effector_id, host_id)
        classes = sorted(set(evidence_by_interaction.get(row.get("interaction_id"), [])))
        effector_edges[pair] = {
            "id": row.get("interaction_id") or f"EFF:{effector_id}:{host_id}",
            "source": effector_id,
            "target": host_id,
            "type": "effector_host",
            "database": "PathoMap curated",
            "interaction_type": row.get("interaction_type"),
            "mechanism": row.get("mechanism"),
            "evidence_classes": classes,
            "strongest_evidence_class": strongest_evidence_class(classes),
            "provenance": row.get("provenance"),
            "score": None,
        }
    effector_edges_list = sorted(effector_edges.values(), key=lambda row: row["id"])

    adjacency: dict[str, set[str]] = {node: set() for node in host_nodes}
    weighted_adjacency: dict[str, dict[str, float]] = {node: {} for node in host_nodes}
    for edge in host_host_edges_list:
        source, target = edge["source"], edge["target"]
        adjacency[source].add(target)
        adjacency[target].add(source)
        weight = edge["score"] if isinstance(edge["score"], (int, float)) else 1.0
        weighted_adjacency[source][target] = max(weighted_adjacency[source].get(target, 0.0), weight)
        weighted_adjacency[target][source] = max(weighted_adjacency[target].get(source, 0.0), weight)

    degrees = {node: len(adjacency[node]) for node in host_nodes}
    weighted_degrees = {node: round(sum(weighted_adjacency[node].values()), 3) for node in host_nodes}
    betweenness = brandes_betweenness(host_nodes, adjacency)
    closeness = closeness_harmonic(host_nodes, adjacency)
    clustering = clustering_coefficient(host_nodes, adjacency)
    components = undirected_components(host_nodes, adjacency)
    communities = greedy_modularity_communities(host_nodes, weighted_adjacency)

    effector_target_degree: Counter[str] = Counter()
    effector_degree: Counter[str] = Counter()
    for edge in effector_edges_list:
        effector_target_degree[edge["target"]] += 1
        effector_degree[edge["source"]] += 1

    nodes = []
    for entity_id in host_nodes:
        row = hosts[entity_id]
        nodes.append({
            "id": entity_id,
            "type": "host_protein",
            "label": row.get("protein_name"),
            "gene_name": row.get("gene_name"),
            "uniprot_id": row.get("uniprot_id"),
            "degree": degrees[entity_id],
            "weighted_degree": weighted_degrees[entity_id],
            "betweenness": betweenness[entity_id],
            "closeness": closeness[entity_id],
            "clustering_coefficient": clustering[entity_id],
            "component_id": components[entity_id],
            "community_id": communities.get(entity_id),
            "effector_target_degree": effector_target_degree.get(entity_id, 0),
        })

    nodes_with_edges = [node for node in nodes if node["degree"] > 0]
    top_degree = sorted(nodes_with_edges, key=lambda row: (-row["degree"], row["id"]))[:10]
    top_betweenness = sorted(nodes_with_edges, key=lambda row: (-row["betweenness"], row["id"]))[:10]
    hub_bases: dict[str, set[str]] = defaultdict(set)
    for row in top_degree:
        hub_bases[row["id"]].add("degree")
    for row in top_betweenness:
        hub_bases[row["id"]].add("betweenness")
    hubs = [
        {
            "id": node["id"],
            "label": node["label"],
            "gene_name": node["gene_name"],
            "degree": node["degree"],
            "betweenness": node["betweenness"],
            "bases": sorted(hub_bases[node["id"]]),
        }
        for node in nodes
        if node["id"] in hub_bases
    ]
    hubs.sort(key=lambda row: (-row["degree"], -row["betweenness"], row["id"]))

    component_sizes = Counter(components.values())
    community_sizes = Counter(value for value in communities.values() if value is not None)
    host_host_edge_count = len(host_host_edges_list)
    reasons: list[str] = []
    low_power: list[str] = []
    if not host_host_edges_list:
        reasons.append("No host-host STRING edges are available.")
    elif host_host_edge_count < PARAMETERS["min_host_host_edges"]:
        low_power.append(f"Only {host_host_edge_count} host-host STRING edges are available.")
    if len(nodes_with_edges) < PARAMETERS["min_host_nodes_with_edges"] and host_host_edges_list:
        low_power.append(f"Only {len(nodes_with_edges)} host proteins have host-host edges.")

    result = {
        "schema_version": OUTPUT_SCHEMA_VERSION,
        "status": status_from_reasons(reasons, low_power=low_power),
        "status_reasons": reasons,
        "warnings": warnings,
        "meta": provenance_meta(
            analysis="protein_network",
            analysis_version=ANALYSIS_VERSION,
            dataset=dataset,
            source_bytes=source_bytes,
            dataset_path=dataset_path,
            input_tables=INPUT_TABLES,
            parameters={**PARAMETERS, **(parameters or {})},
        ),
        "statistics": {
            "host_node_count": len(host_nodes),
            "host_nodes_with_host_edges": len(nodes_with_edges),
            "host_host_edge_count": host_host_edge_count,
            "effector_host_edge_count": len(effector_edges_list),
            "effector_node_count": len({edge["source"] for edge in effector_edges_list}),
            "component_count": len(component_sizes),
            "non_isolated_component_count": len({components[node["id"]] for node in nodes_with_edges}),
            "largest_component_size": max(component_sizes.values()) if component_sizes else 0,
            "community_count": len(community_sizes),
            "hub_count": len(hubs),
            "mean_degree": round(sum(degrees.values()) / len(host_nodes), 3) if host_nodes else 0,
            "max_degree": max(degrees.values()) if degrees else 0,
            "max_betweenness": max(betweenness.values()) if betweenness else 0,
        },
        "nodes": nodes,
        "edges": host_host_edges_list,
        "effector_edges": effector_edges_list,
        "hubs": hubs,
        "components": [
            {"component_id": component_id, "size": size}
            for component_id, size in sorted(component_sizes.items())
        ],
        "communities": [
            {"community_id": community_id, "size": size}
            for community_id, size in sorted(community_sizes.items())
        ],
        "validation": {
            "issues": sorted(validation_issues, key=issue_sort_key),
            "issue_counts": count_issue_codes(validation_issues),
        },
    }
    return result


def validate_result(result: dict) -> list[dict]:
    issues: list[dict] = []
    node_ids = {node["id"] for node in result.get("nodes", [])}
    edge_ids = set()
    for edge in result.get("edges", []):
        if edge["id"] in edge_ids:
            issues.append(issue("duplicate_edge_id", "Duplicate network edge.", edge["id"]))
        edge_ids.add(edge["id"])
        if edge["source"] not in node_ids or edge["target"] not in node_ids:
            issues.append(issue("dangling_edge", "Edge references a missing host node.", edge["id"]))
    for node in result.get("nodes", []):
        if not (0.0 <= node["betweenness"] <= 1.0):
            issues.append(issue("betweenness_range", "Betweenness outside [0, 1].", node["id"]))
        if not (0.0 <= node["closeness"] <= 1.0):
            issues.append(issue("closeness_range", "Closeness outside [0, 1].", node["id"]))
        if not (0.0 <= node["clustering_coefficient"] <= 1.0):
            issues.append(issue("clustering_range", "Clustering coefficient outside [0, 1].", node["id"]))
    if result["statistics"]["host_host_edge_count"] != len(result.get("edges", [])):
        issues.append(issue("edge_count_mismatch", "Host-host edge count does not match edges."))
    return issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, default=DATASET_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--check", action="store_true", help="calculate without writing the artifact")
    parser.add_argument("--strict", action="store_true", help="exit non-zero on validation issues")
    parser.add_argument("--refresh", action="store_true", help="ignore cached STRING responses")
    parser.add_argument("--no-network", action="store_true", help="use only cached STRING responses")
    args = parser.parse_args(argv)

    try:
        dataset, source_bytes = read_dataset(args.dataset)
    except (OSError, ValueError) as exc:
        print(f"error: cannot read dataset: {exc}", file=sys.stderr)
        return 2

    result = analyze(dataset, source_bytes, dataset_path=args.dataset, args=args)
    result_issues = validate_result(result)
    result["validation"]["issues"].extend(result_issues)
    result["validation"]["issues"].sort(key=issue_sort_key)
    result["validation"]["issue_counts"] = count_issue_codes(result["validation"]["issues"])
    if not args.check:
        write_json_atomic(args.output, result)

    stats = result["statistics"]
    print(f"status: {result['status']}")
    print(f"host-host edges: {stats['host_host_edge_count']}")
    print(f"effector-host edges: {stats['effector_host_edge_count']}")
    print(f"components: {stats['component_count']}; communities: {stats['community_count']}")
    print(f"hubs: {stats['hub_count']}")
    issues = result["validation"]["issues"]
    if issues:
        print(f"validation: {len(issues)} issue(s)", file=sys.stderr)
        for item in issues[:10]:
            row = f" [{item['row_id']}]" if item.get("row_id") else ""
            print(f"  {item['code']}{row}: {item['detail']}", file=sys.stderr)
    else:
        print("validation: ok")
    return 1 if args.strict and issues else 0


if __name__ == "__main__":
    raise SystemExit(main())

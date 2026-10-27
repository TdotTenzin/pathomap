"""
interactome.py — Host-pathogen interaction network analysis.

Builds a bipartite network where:
  • Nodes are either pathogens (effectors) or host proteins
  • Edges represent "effector targets host protein" relationships

Provides centrality analysis to identify hub host proteins
that are targeted by many different pathogens.
"""

import warnings

import networkx as nx
import numpy as np

from pathomap.data.loader import to_df


def build_network() -> nx.Graph:
    """
    Build a NetworkX graph from the effector_targets table.

    Nodes: host proteins (prefixed "H:") and effectors (prefixed "E:").
    Edges: directed from effector to host target.

    Returns an undirected graph (for centrality metrics) with bipartite
    attributes so we can colour nodes by type.
    """
    df = to_df("""
        SELECT
            e.name AS effector,
            p.name AS pathogen,
            hp.name AS host_protein,
            et.interaction_type
        FROM effector_targets et
        JOIN effectors e ON et.effector_id = e.id
        JOIN host_proteins hp ON et.host_protein_id = hp.id
        JOIN pathogens p ON e.pathogen_id = p.id
    """)

    G = nx.Graph()

    for _, row in df.iterrows():
        effector_node = f"E:{row['effector']}"
        host_node = f"H:{row['host_protein']}"

        # Store effector metadata
        G.add_node(effector_node, type="effector", pathogen=row["pathogen"])
        # Store host metadata
        G.add_node(host_node, type="host_protein")
        # Edge with interaction type
        G.add_edge(
            effector_node,
            host_node,
            interaction=row["interaction_type"],
        )

    return G


def hub_targets(G: nx.Graph, top_n: int = 10) -> list[dict]:
    """
    Return the host proteins with highest degree centrality
    (targeted by the most effectors).

    Parameters:
        G: network returned by build_network()
        top_n: how many top hubs to return

    Returns a list of dicts:
        [{"host": "Rab1", "degree": 6, "centrality": 0.32}, ...]
    """
    # Filter to only host-protein nodes
    host_nodes = [
        n for n, attr in G.nodes(data=True)
        if attr.get("type") == "host_protein"
    ]

    centrality = nx.degree_centrality(G)
    results = []
    for node in host_nodes:
        host_name = node.replace("H:", "")
        results.append({
            "host": host_name,
            "degree": G.degree(node),
            "centrality": round(centrality[node], 4),
        })

    results.sort(key=lambda x: x["degree"], reverse=True)
    return results[:top_n]


def pathogen_subgraph(G: nx.Graph, pathogen_name: str) -> nx.Graph:
    """
    Extract the subgraph of effectors from a specific pathogen
    and all host proteins they target.

    Useful for visualising "what does this pathogen touch?"
    """
    # Find all effector nodes belonging to this pathogen
    pathogen_effectors = [
        n for n, attr in G.nodes(data=True)
        if attr.get("type") == "effector"
        and attr.get("pathogen") == pathogen_name
    ]

    # Get their neighbours (host proteins)
    relevant_nodes = set(pathogen_effectors)
    for e in pathogen_effectors:
        relevant_nodes.update(G.neighbors(e))

    return G.subgraph(relevant_nodes).copy()


def network_stats(G: nx.Graph) -> dict:
    """
    Return summary statistics about the interaction network.
    """
    host_nodes = [
        n for n, attr in G.nodes(data=True)
        if attr.get("type") == "host_protein"
    ]
    effector_nodes = [
        n for n, attr in G.nodes(data=True)
        if attr.get("type") == "effector"
    ]

    return {
        "total_nodes": G.number_of_nodes(),
        "host_proteins": len(host_nodes),
        "effectors": len(effector_nodes),
        "total_interactions": G.number_of_edges(),
        "density": nx.density(G),
    }


def _empty_advanced_metrics() -> dict:
    return {
        "n_nodes": 0,
        "n_edges": 0,
        "density": 0.0,
        "avg_clustering": 0.0,
        "assortativity": None,
        "n_communities": 0,
        "modularity": 0.0,
        "top_betweenness": [],
        "centrality_summary": {
            "betweenness": {"mean": 0.0, "max": 0.0},
            "closeness": {"mean": 0.0, "max": 0.0},
            "eigenvector": {"mean": 0.0, "max": 0.0},
        },
    }


def _node_label(node: str) -> str:
    """Strip the 'E:'/'H:' type prefix used by build_network()."""
    return node.split(":", 1)[1] if ":" in node else node


def advanced_network_metrics(G: nx.Graph, top_n: int = 15) -> dict:
    """
    Comprehensive topology metrics for an interaction (sub)network.

    Beyond the simple counts in network_stats(), this computes the centralities
    and community structure requested for the research view:

      • betweenness / closeness / eigenvector centrality
      • average clustering coefficient and graph density
      • degree assortativity
      • number of communities + modularity (greedy modularity optimisation)

    All metrics on a disconnected bipartite network are still well defined;
    degenerate cases (empty graph, no edges, a non-converging eigenvector
    iteration, or a constant-degree graph) are handled explicitly rather than
    raising, so this is always safe to expose in an API response.
    """
    if G.number_of_nodes() == 0:
        return _empty_advanced_metrics()

    betweenness = nx.betweenness_centrality(G)
    closeness = nx.closeness_centrality(G)

    try:
        eigenvector = nx.eigenvector_centrality(G, max_iter=1000, tol=1e-6)
    except nx.PowerIterationFailedConvergence:
        # Disconnected or near-singular spectra can fail to converge.
        eigenvector = {n: 0.0 for n in G.nodes}

    assortativity: float | None
    with warnings.catch_warnings():
        # networkx emits a numpy RuntimeWarning when the graph has zero-degree
        # variance; the result is NaN, which we normalise to None below.
        warnings.simplefilter("ignore", RuntimeWarning)
        try:
            assortativity = float(nx.degree_assortativity_coefficient(G))
            if assortativity != assortativity:  # NaN guard
                assortativity = None
        except (ValueError, ZeroDivisionError):
            assortativity = None

    communities = list(nx.community.greedy_modularity_communities(G))
    try:
        modularity = float(nx.community.modularity(G, communities))
    except (ValueError, ZeroDivisionError):
        modularity = 0.0

    def _summary(values: dict[str, float]) -> dict:
        vals = list(values.values())
        return {
            "mean": round(float(np.mean(vals)), 4) if vals else 0.0,
            "max": round(float(np.max(vals)), 4) if vals else 0.0,
        }

    ranked = sorted(betweenness.items(), key=lambda kv: kv[1], reverse=True)[:top_n]
    top_betweenness = [
        {
            "node": _node_label(node),
            "type": G.nodes[node].get("type", "unknown"),
            "betweenness": round(betweenness[node], 4),
            "degree": G.degree(node),
        }
        for node, _ in ranked
    ]

    return {
        "n_nodes": G.number_of_nodes(),
        "n_edges": G.number_of_edges(),
        "density": round(float(nx.density(G)), 4),
        "avg_clustering": round(float(nx.average_clustering(G)), 4),
        "assortativity": None if assortativity is None else round(assortativity, 4),
        "n_communities": len(communities),
        "modularity": round(modularity, 4),
        "top_betweenness": top_betweenness,
        "centrality_summary": {
            "betweenness": _summary(betweenness),
            "closeness": _summary(closeness),
            "eigenvector": _summary(eigenvector),
        },
    }


def _jaccard(a: set, b: set) -> float:
    """Jaccard similarity; defined as 0.0 when both sets are empty."""
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def compare_networks(
    G1: nx.Graph,
    G2: nx.Graph,
    max_edit_nodes: int = 40,
    timeout: float = 5.0,
) -> dict:
    """
    Compare two interaction networks on shared node/edge sets.

    Node and edge overlap are reported as Jaccard indices (scale-free, 0-1).
    Exact graph edit distance is NP-hard and can blow up on real graphs, so it
    is only attempted when the two networks are small enough (|V1|+|V2| <=
    max_edit_nodes) and bounded by a timeout; otherwise the field is null and a
    machine-readable reason is returned instead of hanging.
    """
    v1, v2 = set(G1.nodes), set(G2.nodes)
    e1 = {frozenset(e) for e in G1.edges}
    e2 = {frozenset(e) for e in G2.edges}

    common_nodes = v1 & v2
    neighbor_scores = []
    for n in common_nodes:
        s1 = set(G1.neighbors(n))
        s2 = set(G2.neighbors(n))
        neighbor_scores.append(_jaccard(s1, s2))
    shared_neighbor_similarity = (
        float(np.mean(neighbor_scores)) if neighbor_scores else 0.0
    )

    total_nodes = len(v1) + len(v2)
    edit_distance: int | None = None
    edit_distance_note: str | None
    if total_nodes <= max_edit_nodes:
        try:
            ged = nx.graph_edit_distance(G1, G2, timeout=timeout)
            if ged is None:
                edit_distance_note = "not computed (timed out)"
            else:
                edit_distance = int(ged)
                edit_distance_note = None
        except Exception:  # noqa: BLE001 - any failure degrades to "unavailable"
            edit_distance_note = "not computed (error)"
    else:
        edit_distance_note = (
            f"skipped: {total_nodes} total nodes exceeds limit {max_edit_nodes}"
        )

    return {
        "n_nodes_1": len(v1),
        "n_nodes_2": len(v2),
        "n_edges_1": len(e1),
        "n_edges_2": len(e2),
        "common_nodes": len(common_nodes),
        "shared_edges": len(e1 & e2),
        "node_jaccard": round(_jaccard(v1, v2), 4),
        "edge_jaccard": round(_jaccard(e1, e2), 4),
        "shared_neighbor_similarity": round(shared_neighbor_similarity, 4),
        "graph_edit_distance": edit_distance,
        "graph_edit_distance_note": edit_distance_note,
    }

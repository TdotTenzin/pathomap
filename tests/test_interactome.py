"""
Tests for the interactome module (network construction + centrality analysis).
"""

import networkx as nx

from pathomap.interactome import (
    advanced_network_metrics,
    build_network,
    compare_networks,
    hub_targets,
    network_stats,
    pathogen_subgraph,
)


def test_build_network_returns_graph():
    """build_network should return a non-empty NetworkX graph."""
    G = build_network()
    assert isinstance(G, nx.Graph)
    assert G.number_of_nodes() > 0
    assert G.number_of_edges() > 0


def test_build_network_has_both_node_types():
    """Graph should contain both effector and host_protein typed nodes."""
    G = build_network()
    types = set()
    for _, attr in G.nodes(data=True):
        types.add(attr.get("type"))
    assert "effector" in types
    assert "host_protein" in types


def test_hub_targets_returns_sorted():
    """hub_targets should return top hubs sorted by degree descending."""
    G = build_network()
    hubs = hub_targets(G, top_n=10)
    assert len(hubs) <= 10
    assert len(hubs) > 0
    degrees = [h["degree"] for h in hubs]
    assert degrees == sorted(degrees, reverse=True)
    for h in hubs:
        assert "host" in h
        assert "centrality" in h


def test_pathogen_subgraph_known_pathogen():
    """Salmonella enterica should have at least one effector in its subgraph."""
    G = build_network()
    sub = pathogen_subgraph(G, "Salmonella enterica")
    assert sub.number_of_nodes() > 0
    effector_nodes = [
        n for n, attr in sub.nodes(data=True)
        if attr.get("type") == "effector"
    ]
    assert len(effector_nodes) > 0


def test_pathogen_subgraph_unknown_pathogen_empty():
    """Unknown pathogen name should produce an empty subgraph."""
    G = build_network()
    sub = pathogen_subgraph(G, "Nonexistent Pathogen")
    assert sub.number_of_nodes() == 0


def test_network_stats_keys():
    """network_stats should return expected summary fields."""
    G = build_network()
    stats = network_stats(G)
    for key in [
        "total_nodes",
        "host_proteins",
        "effectors",
        "total_interactions",
        "density",
    ]:
        assert key in stats
    assert stats["total_nodes"] == stats["host_proteins"] + stats["effectors"]


def test_advanced_metrics_keys_and_ranges():
    """advanced_network_metrics should return bounded, well-typed metrics."""
    G = build_network()
    m = advanced_network_metrics(G)
    for key in [
        "n_nodes",
        "n_edges",
        "density",
        "avg_clustering",
        "assortativity",
        "n_communities",
        "modularity",
        "top_betweenness",
        "centrality_summary",
    ]:
        assert key in m
    assert 0.0 <= m["density"] <= 1.0
    assert 0.0 <= m["avg_clustering"] <= 1.0
    assert m["n_nodes"] > 0
    assert m["n_communities"] >= 1
    assert len(m["top_betweenness"]) > 0
    # top_betweenness is ranked descending
    bets = [r["betweenness"] for r in m["top_betweenness"]]
    assert bets == sorted(bets, reverse=True)


def test_advanced_metrics_empty_graph_is_safe():
    """An empty graph must not raise and must return zeroed metrics."""
    m = advanced_network_metrics(nx.Graph())
    assert m["n_nodes"] == 0
    assert m["n_communities"] == 0
    assert m["top_betweenness"] == []


def test_advanced_metrics_reproducible():
    """Determinism: same graph -> same metrics."""
    G = build_network()
    assert advanced_network_metrics(G) == advanced_network_metrics(G)


def test_compare_networks_identity_and_disjoint():
    """A network is identical to itself and disjoint from an unrelated graph."""
    G = build_network()
    self_cmp = compare_networks(G, G)
    assert self_cmp["node_jaccard"] == 1.0
    assert self_cmp["edge_jaccard"] == 1.0
    assert self_cmp["shared_neighbor_similarity"] == 1.0

    other = nx.Graph()
    other.add_edge("X:a", "Y:b")
    disjoint = compare_networks(G, other)
    assert disjoint["node_jaccard"] == 0.0
    assert disjoint["edge_jaccard"] == 0.0
    assert disjoint["shared_edges"] == 0


def test_compare_networks_small_graph_edit_distance():
    """Exact edit distance is computed for small graphs (identity -> 0)."""
    g1 = nx.Graph()
    g1.add_edges_from([("A", "B"), ("B", "C")])
    g2 = nx.Graph()
    g2.add_edges_from([("A", "B"), ("B", "C")])
    result = compare_networks(g1, g2)
    assert result["graph_edit_distance"] == 0
    assert result["graph_edit_distance_note"] is None


def test_compare_networks_skips_large_edit_distance():
    """Exact edit distance is skipped for graphs above the node budget."""
    G = build_network()
    result = compare_networks(G, G, max_edit_nodes=1)
    assert result["graph_edit_distance"] is None
    assert "skipped" in (result["graph_edit_distance_note"] or "")


def test_compare_networks_partial_overlap():
    """Two subgraphs sharing host nodes should have 0 < jaccard < 1."""
    G = build_network()
    a = pathogen_subgraph(G, "Salmonella enterica")
    b = pathogen_subgraph(G, "Mycobacterium tuberculosis")
    result = compare_networks(a, b)
    assert 0.0 <= result["node_jaccard"] <= 1.0
    assert result["n_nodes_1"] == a.number_of_nodes()
    assert result["n_nodes_2"] == b.number_of_nodes()

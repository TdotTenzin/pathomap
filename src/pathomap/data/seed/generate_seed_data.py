"""Generate expanded seed CSV files for the host-pathogen database."""

import csv
import pathlib

SEED_DIR = pathlib.Path(__file__).parent

# ── Pathogens ──────────────────────────────────────────────────────────────

PATHOGENS = [
    # Original 5
    ("Salmonella enterica", "Salmonella enterica serovar Typhimurium", "Gram-negative", "modified_compartment",
     "Resides in SCV; acquires LAMP1 but blocks hydrolase delivery; maintains non-degradative niche via SPI-2 T3SS effectors. SifA binds SKIP to displace Rab9, while SseJ deacylates cholesterol to prevent SCV-lysosome fusion. SCV matures into a LAMP1+ compartment that is non-degradative — Rab7 effectors (RILP, ORP1L) are decoupled from hydrolase delivery",
     "10.1016/j.tim.2019.01.007"),
    ("Listeria monocytogenes", "Listeria monocytogenes", "Gram-positive", "escape",
     "Phagosomal escape via LLO within ~30 min; replicates in cytosol; uses ActA for actin-based motility. LLO is pH-dependent: forms pores at acidic pH of early phagosomes but is inactivated at neutral cytosolic pH. ActA nucleates Arp2/3-dependent branched actin networks for cytoplasmic motility and cell-to-cell spread via double-membrane protrusions",
     "10.1038/s41579-018-0106-8"),
    ("Mycobacterium tuberculosis", "Mycobacterium tuberculosis", "Acid-fast", "arrest",
     "Arrests phagosome at early stage; blocks Rab5-to-Rab7 conversion; maintains near-neutral pH (~6.4) by excluding V-ATPase. Secretes SapM phosphatase to deplete PI3P from phagosomal membranes, and lipoarabinomannan (LAM) inhibits Ca2+ signaling and Vps34 recruitment. PknG and PtpA further modulate host Rab trafficking to prevent lysosomal fusion",
     "10.1038/s41579-019-0216-y"),
    ("Legionella pneumophila", "Legionella pneumophila", "Gram-negative", "reroute",
     "Redirects ER-derived vesicles to build LCV; bypasses endocytic pathway entirely via Dot/Icm T4SS. DrrA/SidM is a Rab1 GEF that activates Rab1 on the LCV, redirecting COPII vesicle traffic from ER to the pathogen vacuole. AnkX phosphocholinates Rab35 and Rab1, locking them in an inactive state — a post-translational block distinct from host regulation",
     "10.1038/s41579-018-0126-4"),
    ("Shigella flexneri", "Shigella flexneri", "Gram-negative", "escape",
     "Rapid phagosome lysis (<15 min) via IpaB pore; escapes to cytosol before early markers fully acquired. IpaB inserts into the phagosomal membrane and oligomerizes to form a translocation pore. In the cytosol, IcsB masks IcsA from the autophagy receptor LC3 to evade xenophagy. Uses IcsA/VirG to recruit N-WASP and Arp2/3 for actin-based motility",
     "10.1038/s41579-019-0190-4"),
    # Additional Gram-negative — modified compartment
    ("Brucella abortus", "Brucella abortus", "Gram-negative", "modified_compartment",
     "Resides in Brucella-containing vacuole (BCV) that interacts with ER; avoids lysosomal fusion via VirB T4SS. BtpA and BtpB are TIR-domain containing effectors that inhibit TLR2 signaling and MyD88 adaptor function. VceC activates the unfolded protein response, creating a replicative niche that balances ER stress signaling with survival",
     "10.1038/s41579-019-0188-y"),
    ("Francisella tularensis", "Francisella tularensis", "Gram-negative", "escape",
     "Escapes phagosome within 30-60 min via acid-dependent mechanism; replicates in cytosol. IglC and IglD are essential T6SS components that mediate phagosomal disruption. Once cytosolic, Francisella evades autophagy detection by modifying its LPS structure and subverts host interferon responses through MglA-mediated virulence gene regulation",
     "10.3389/fcimb.2018.00123"),
    ("Coxiella burnetii", "Coxiella burnetii", "Gram-negative", "modified_compartment",
     "Resides in acidified Coxiella-containing vacuole (CCV) that fuses with lysosomes; requires acidic pH for replication — uniquely thrives in phagolysosomes. Cig57 subverts clathrin-mediated trafficking, while CvpB binds PI3P and Rab5 for CCV biogenesis. CirA and CirB intercept HOPS and exocyst tethering complexes for CCV expansion",
     "10.1038/s41579-019-0191-3"),
    ("Yersinia pestis", "Yersinia pestis", "Gram-negative", "extracellular",
     "Extracellular pathogen that resists phagocytosis via Yop T3SS effectors; blocks phagocytic uptake. YopH dephosphorylates FAK and p130Cas to disrupt focal adhesions, while YopJ acetylates MAPKK and IKK to block NF-kB and MAPK signaling. YopE acts as a GAP for RhoA, Rac1, and Cdc42 to paralyze actin dynamics",
     "10.1038/s41579-017-0020-8"),
    ("Yersinia pseudotuberculosis", "Yersinia pseudotuberculosis", "Gram-negative", "extracellular",
     "Extracellular pathogen; injects Yop effectors via T3SS to disrupt actin and block phagocytosis. Shares core Yop arsenal with Y. pestis including YopE (RhoGAP), YopH (PTPase), and YopJ (MAPKK acetyltransferase). YpkA/YopO binds actin and RhoA to further disrupt the cytoskeleton in infected cells",
     "10.1111/j.1365-2958.2012.08077.x"),
    # Additional Gram-negative — reroute
    ("Chlamydia trachomatis", "Chlamydia trachomatis", "Gram-negative", "reroute",
     "Resides in non-acidified inclusion that intercepts exocytic vesicles from Golgi; avoids endolysosomal fusion. Inc proteins (IncA, IncB, IncC) decorate the inclusion membrane and recruit Rab4, Rab6, and Rab11 to intercept Golgi-derived vesicles. CT229 acts as a ubiquitin ligase to modify host Rab proteins, blocking fusion with lysosomes",
     "10.1038/s41579-019-0237-6"),
    ("Chlamydia pneumoniae", "Chlamydia pneumoniae", "Gram-negative", "reroute",
     "Similar inclusion-based intracellular niche; acquires sphingolipids from Golgi via T3SS inc proteins. IncA blocks SNARE-mediated fusion with lysosomes, while CPn0585 acts as a GEF for host Rab GTPases to redirect vesicular trafficking away from the endolysosomal pathway",
     "10.1128/IAI.00731-19"),
    ("Anaplasma phagocytophilum", "Anaplasma phagocytophilum", "Gram-negative", "reroute",
     "Resides in non-fusogenic membrane-bound inclusion that acquires host-derived membrane via T4SS. Ats-1 binds Rab5 and PI3P to anchor the inclusion to early endosomal compartments, while AnkA modulates host signaling through interaction with MYADM and Abl-1 tyrosine kinase. p44/Msp2 undergoes antigenic variation to evade immune detection",
     "10.1111/j.1365-2958.2012.08037.x"),
    ("Ehrlichia chaffeensis", "Ehrlichia chaffeensis", "Gram-negative", "reroute",
     "Resides in early endosome-like inclusions that avoid lysosomal fusion; uses T4SS for effector translocation. TRP120 mimics Notch ligand to activate Notch signaling and promote host cell survival, while TRP32 activates the Wnt pathway. Ank200 is an ankyrin-repeat effector that modulates host gene expression from within the inclusion",
     "10.3389/fcimb.2018.00097"),
    ("Bartonella henselae", "Bartonella henselae", "Gram-negative", "reroute",
     "Injectisome (VirB/VirD4 T4SS) translocates Bep effectors; subverts host cell functions including actin dynamics. BepA promotes F-actin fiber formation and has anti-apoptotic activity, while BepC activates PI3K/Akt signaling to promote endothelial cell proliferation. BepD and BepE modulate actin recruitment and protect against host cell death",
     "10.1038/s41579-020-0379-4"),
    # Additional Gram-negative — escape
    ("Rickettsia rickettsii", "Rickettsia rickettsii", "Gram-negative", "escape",
     "Rapid phagosomal escape via hemolysin and phospholipase; replicates in cytosol; actin-based motility. RickA activates Arp2/3 to nucleate actin tails, while Sca2 acts as a formin-like actin nucleator for enhanced motility. TlyA and Pat1 are hemolysin and patatin-like phospholipase that mediate rapid phagosomal membrane disruption within minutes of entry",
     "10.1128/CMR.00032-19"),
    ("Rickettsia conorii", "Rickettsia conorii", "Gram-negative", "escape",
     "Phagosomal escape within 15 min; intracytosolic replication; actin tail formation via RickA and Sca2-mediated actin nucleation. Uses Pat1 phospholipase to disrupt phagosomal membranes. Causes Mediterranean spotted fever; transmitted by Rhipicephalus ticks with endothelial cells as primary target",
     "10.3389/fcimb.2017.00322"),
    # Additional Gram-negative — arrest
    ("Salmonella typhi", "Salmonella typhi", "Gram-negative", "modified_compartment",
     "Similar SCV-based strategy as S. enterica; SPI-2 effectors maintain vacuolar niche. Uses SopE to activate Cdc42 for entry, while SifA binds SKIP to maintain SCV integrity. SseF and SseG are SPI-2 effectors that position the SCV near the Golgi apparatus by recruiting microtubule motors, ensuring access to nutrient-rich vesicles",
     "10.1128/CMR.00112-20"),
    ("Pseudomonas aeruginosa", "Pseudomonas aeruginosa", "Gram-negative", "extracellular",
     "Extracellular opportunistic pathogen; injects ExoU/ExoS/ExoT via T3SS; cytotoxic to host cells. ExoU is a potent phospholipase A2 that causes rapid plasma membrane lysis, while ExoS and ExoT act as both RhoGAPs and ADP-ribosyltransferases. ExoY is an adenylate cyclase that disrupts actin dynamics by raising cAMP/cGMP levels in infected cells",
     "10.1038/s41579-020-0353-1"),
    ("Escherichia coli K1", "Escherichia coli K1", "Gram-negative", "arrest",
     "Survives within late endosomes/lysosomes by modulating Rab GTPase activity; K1 capsule prevents clearance. IbeA binds vimentin to mediate invasion of brain microvascular endothelial cells, enabling traversal of the blood-brain barrier. CNF1 deamidates RhoA, Rac1, and Cdc42, constitutively activating them to disrupt phagosome maturation",
     "10.3389/fcimb.2020.00001"),
    ("Neisseria gonorrhoeae", "Neisseria gonorrhoeae", "Gram-negative", "extracellular",
     "Extracellular mucosal pathogen; type IV pili and Opa proteins mediate adhesion; resists intracellular killing. PorB is a voltage-gated porin that targets mitochondria and inhibits host cell apoptosis. Opa proteins bind CEACAM receptors to trigger bacterial uptake into non-phagocytic cells, where Neisseria can survive intracellularly",
     "10.1038/s41579-018-0131-5"),
    ("Neisseria meningitidis", "Neisseria meningitidis", "Gram-negative", "extracellular",
     "Encapsulated extracellular pathogen; survives in bloodstream and cerebrospinal fluid; type IV pili for adhesion. PorB and PorA are major outer membrane porins with anti-apoptotic activity. Opca binds CEACAM and fibronectin, while NadA mediates adhesion to epithelial cells. Capsular polysaccharide (serogroups A, B, C, W, Y) is essential for serum resistance",
     "10.1038/s41579-019-0240-y"),
    ("Haemophilus influenzae", "Haemophilus influenzae", "Gram-negative", "extracellular",
     "Extracellular respiratory pathogen; IgA protease and biofilm formation; survives intracellularly in some cell types. Hap autotransporter mediates adherence and microcolony formation via its serine protease activity. HMW1/HMW2 and Hia are high-molecular-weight adhesins that bind epithelial cells. P5 fimbriae bind ICAM-1 on activated respiratory epithelium",
     "10.1128/IAI.00475-19"),
    ("Bordetella pertussis", "Bordetella pertussis", "Gram-negative", "extracellular",
     "Extracellular respiratory pathogen; adenylate cyclase toxin and T3SS effectors modulate host immunity. Pertussis toxin (PTx) ADP-ribosylates Gi proteins to disrupt cAMP signaling, while CyaA is a bifunctional RTX toxin that enters phagocytes and generates supraphysiological cAMP levels. FHA mediates adhesion to CR3 integrins on macrophages",
     "10.1038/s41579-019-0223-z"),
    ("Vibrio cholerae", "Vibrio cholerae", "Gram-negative", "extracellular",
     "Non-invasive extracellular pathogen; cholera toxin (CTX) is an AB toxin that ADP-ribosylates Gs-alpha, causing constitutive adenylate cyclase activation and massive fluid secretion into the intestinal lumen. The toxin-coregulated pilus (TCP) is essential for intestinal colonization. T6SS (VSP locus) mediates interbacterial competition in the gut microbiome",
     "10.1038/s41579-018-0129-1"),
    ("Campylobacter jejuni", "Campylobacter jejuni", "Gram-negative", "modified_compartment",
     "Survives within Campylobacter-containing vacuole (CCV); uses T6SS and flagellar secretion. Cytolethal distending toxin (Cdt) is a DNase that causes host cell cycle arrest at G2/M phase. FlaA flagellin is glycosylated and activates TLR5, contributing to intestinal inflammation. CiaB and VirK are secreted factors that promote intracellular survival within the CCV",
     "10.3389/fcimb.2019.00360"),
    ("Helicobacter pylori", "Helicobacter pylori", "Gram-negative", "extracellular",
     "Gastric extracellular pathogen that colonizes the stomach mucosa; Cag T4SS injects CagA effector into host cells where it is phosphorylated and activates SHP-2 phosphatase, disrupting cell polarity and adhesion. VacA forms pores in host membranes and targets mitochondria to induce apoptosis. UreA neutralizes gastric acid by producing ammonia from urea",
     "10.1038/s41579-019-0253-6"),
    ("Orientia tsutsugamushi", "Orientia tsutsugamushi", "Gram-negative", "escape",
     "Escapes phagosome via phospholipase D activity; replicates in cytosol; subverts autophagy. Pld is a phospholipase D homolog that disrupts phagosomal membranes shortly after entry. ScaA and ScaC are autotransporter proteins mediating adhesion to host cells. Tsa56 is the major outer membrane protein involved in immune evasion. Causes scrub typhus transmitted by chiggers",
     "10.3389/fcimb.2018.00012"),
    # Gram-positive — additional
    ("Staphylococcus aureus", "Staphylococcus aureus", "Gram-positive", "escape",
     "Pore-forming toxins (Hla, PVL) enable phagosomal escape; some strains survive intracellularly. Hla (alpha-hemolysin) binds ADAM10 to form heptameric pores in host membranes, while PVL targets C5aR on neutrophils. Protein A (SpA) binds IgG Fc region and cross-links VH3-type B cell receptors, acting as a B-cell superantigen. Efb binds fibrinogen to form immune-evasive clots",
     "10.1038/s41579-018-0103-y"),
    ("Streptococcus pyogenes", "Streptococcus pyogenes", "Gram-positive", "escape",
     "Streptolysin O (SLO) enables phagosomal escape; replicates in cytosol; M protein for adhesion. SLO is a cholesterol-dependent cytolysin that forms large pores in phagosomal membranes. M protein binds Factor H and C4BP to evade complement opsonization. SpeA is a superantigen that bridges MHC class II and TCR V-beta regions, triggering massive cytokine release",
     "10.3389/fcimb.2019.00071"),
    ("Streptococcus pneumoniae", "Streptococcus pneumoniae", "Gram-positive", "extracellular",
     "Extracellular pathogen; pneumolysin (PLY) and polysaccharide capsule; can survive intracellularly. PLY is a cholesterol-dependent cytolysin that forms pores and activates the NLRP3 inflammasome. PspA binds lactoferrin to reduce iron availability for host defenses, while PspC binds Factor H for complement evasion. LytA autolysin releases pneumolysin during antibiotic-induced lysis",
     "10.1038/s41579-018-0125-5"),
    ("Bacillus anthracis", "Bacillus anthracis", "Gram-positive", "escape",
     "Anthrolysin O (ALO) enables phagosomal escape; lethal factor (LF) and edema factor (EF) modulate host. ALO is a cholesterol-dependent cytolysin that permeabilizes the phagosome. The tripartite toxin (PA + LF + EF) is the major virulence determinant: PA binds ANTXR1/2 to translocate LF (zinc metalloprotease cleaving MAPKKs) and EF (calmodulin-dependent adenylate cyclase) into the cytosol",
     "10.1038/s41579-019-0263-4"),
    ("Bacillus cereus", "Bacillus cereus", "Gram-positive", "escape",
     "Opportunistic pathogen capable of intracellular survival via pore-forming toxins including hemolysin BL (Hbl), non-hemolytic enterotoxin (Nhe), and cytotoxin K (CytK). These three-component pore-forming toxins cause membrane disruption and cell lysis. PC-PLC (phosphatidylcholine-hydrolyzing phospholipase C) contributes to membrane degradation and tissue necrosis",
     "10.3389/fcimb.2019.00087"),
    ("Clostridium perfringens", "Clostridium perfringens", "Gram-positive", "extracellular",
     "Extracellular pathogen causing gas gangrene and food poisoning; perfringolysin O (PFO) is a cholesterol-dependent cytolysin that forms large transmembrane pores. Alpha-toxin (PLC) is a zinc-dependent phospholipase C that hydrolyzes phosphatidylcholine and sphingomyelin, causing hemolysis and necrosis. CPE (C. perfringens enterotoxin) binds claudins to disrupt tight junctions",
     "10.1038/s41579-019-0257-2"),
    ("Clostridium difficile", "Clostridium difficile", "Gram-positive", "extracellular",
     "Extracellular toxigenic pathogen causing antibiotic-associated diarrhea and pseudomembranous colitis. TcdA and TcdB are large clostridial glucosyltransferases that inactivate Rho GTPases (RhoA, Rac1, Cdc42) by monoglucosylation, leading to actin cytoskeleton disruption and tight junction breakdown. Cdt (binary toxin) ADP-ribosylates actin, causing microtubule-based protrusions",
     "10.1038/s41579-019-0266-1"),
    ("Enterococcus faecalis", "Enterococcus faecalis", "Gram-positive", "extracellular",
     "Opportunistic extracellular pathogen causing nosocomial and device-associated infections; survives within macrophages. Cytolysin (Cyl) is a hemolytic/bactericidal toxin that lyses host cells. Gelatinase (GelE) degrades host ECM proteins for tissue invasion. Ace adhesin binds collagen for adherence to host tissues. Esp surface protein promotes biofilm formation",
     "10.3389/fcimb.2019.00126"),
    ("Corynebacterium diphtheriae", "Corynebacterium diphtheriae", "Gram-positive", "extracellular",
     "Extracellular respiratory pathogen; diphtheria toxin (DT) is an AB toxin that ADP-ribosylates elongation factor 2 (EF-2), inhibiting host protein synthesis and causing cell death. DT is encoded by a lysogenic beta-prophage — only toxigenic strains cause disease. FbpABC iron transporter scavenges host iron for bacterial growth. SpaABC pili mediate adhesion to respiratory epithelium",
     "10.1128/CMR.00075-19"),
    ("Nocardia asteroides", "Nocardia asteroides", "Gram-positive", "arrest",
     "Arrests phagosome maturation at early stage; blocks acidification; survives in macrophages. Mce (mammalian cell entry) proteins mediate invasion and intracellular survival. Phospholipase A (PLA) contributes to phagosomal membrane disruption, while superoxide dismutase (Sod) and catalase (Cat) neutralize host oxidative burst. Causes nocardiosis in immunocompromised patients",
     "10.1086/515160"),
    ("Rhodococcus equi", "Rhodococcus equi", "Gram-positive", "modified_compartment",
     "Resides in non-acidified Rhodococcus-containing vacuole (RCV); prevents lysosomal fusion via Vap proteins (VapA, VapB, VapC, VapD). VapA is the major virulence factor, a surface-expressed protein that modulates host vesicular trafficking and prevents lysosomal hydrolase delivery. Causes pneumonia in foals and opportunistic infections in immunocompromised humans",
     "10.1111/j.1365-2958.2012.08093.x"),
    ("Tropheryma whipplei", "Tropheryma whipplei", "Gram-positive", "arrest",
     "Arrests phagosome maturation; survives in macrophages; causes Whipple disease — a rare systemic infection affecting the gastrointestinal tract and joints. TW surface proteins mediate adhesion and intracellular survival. The bacterium has a reduced genome and relies on host-derived amino acids and metabolites. Survives within macrophages by blocking acidification and lysosomal fusion",
     "10.3389/fcimb.2019.00149"),
    ("Mycobacterium leprae", "Mycobacterium leprae", "Acid-fast", "arrest",
     "Similar to M. tuberculosis; arrests phagosome maturation at the early stage; uniquely inhabits Schwann cells and macrophages. LAM (lipoarabinomannan) inhibits Vps34 and Ca2+ signaling to block phagosome maturation. ML0098 modulates TLR signaling to prevent pro-inflammatory responses. Causes leprosy with tropism for peripheral nerves leading to demyelination",
     "10.1038/s41579-020-0382-9"),
    ("Mycobacterium bovis", "Mycobacterium bovis", "Acid-fast", "arrest",
     "Intracellular pathogen causing tuberculosis in cattle; BCG (Bacille Calmette-Guerin) is an attenuated strain used as a vaccine against human TB. Arrests phagosome maturation by inhibiting V-ATPase recruitment and Rab7 acquisition. ESAT-6 and CFP-10 are T7SS (ESX-1) secreted effectors that mediate phagosomal permeabilization and intercellular spread",
     "10.1128/IAI.00687-19"),
    ("Mycobacterium avium", "Mycobacterium avium", "Acid-fast", "arrest",
     "Opportunistic environmental mycobacterium causing disseminated disease in immunocompromised patients (especially advanced HIV/AIDS). Survives and replicates within macrophages by blocking phagosome acidification and lysosomal fusion via LAM-mediated inhibition of Vps34 and PI3P production. MAV_2941 is a secreted factor that promotes intracellular survival",
     "10.3389/fcimb.2019.00108"),
    ("Mycobacterium marinum", "Mycobacterium marinum", "Acid-fast", "arrest",
     "Model organism for studying mycobacterial pathogenesis in zebrafish infection model. Arrests phagosome maturation and prevents acidification similar to M. tuberculosis. ESAT-6 (ESX-1 T7SS effector) forms pores in phagosomal membranes to promote permeabilization. MMPL7 is an efflux pump involved in drug resistance. Causes fish tuberculosis and granulomatous skin infections in humans",
     "10.1111/j.1365-2958.2012.08055.x"),
    ("Streptomyces scabies", "Streptomyces scabies", "Gram-positive", "extracellular",
     "Plant pathogen causing common scab disease in potato and other root crops. Produces thaxtomin A, a phytotoxin that inhibits cellulose biosynthesis in plant cell walls, leading to cell swelling and tissue necrosis. TxtA, TxtB, and TxtC are key synthetases in the thaxtomin biosynthesis pathway. Nec1 is a necrosis-inducing virulence factor that promotes plant tissue maceration",
     "10.1111/j.1365-2958.2012.08066.x"),
    ("Porphyromonas gingivalis", "Porphyromonas gingivalis", "Gram-negative", "modified_compartment",
     "Oral keystone pathogen causing periodontitis; hijacks host endocytic pathway and survives within gingival epithelial cells. Gingipains (RgpA, RgpB, Kgp) are cysteine proteases that degrade host ECM proteins, activate PAR signaling, and subvert complement. FimA fimbriae bind CD14/TLR2 to trigger inflammatory signaling and promote intracellular invasion",
     "10.3389/fcimb.2019.00098"),
    ("Klebsiella pneumoniae", "Klebsiella pneumoniae", "Gram-negative", "extracellular",
     "Encapsulated nosocomial pathogen causing pneumonia and urinary tract infections; emerging hypervirulent strains with enhanced mucoviscosity. CPS (capsular polysaccharide) is the major antiphagocytic factor — over 80 serotypes known. LPS activates TLR4 triggering inflammatory responses. FimH (type 1) and MrkD (type 3) fimbriae mediate adhesion to host tissues and biofilm formation",
     "10.1038/s41579-019-0265-2"),
    ("Acinetobacter baumannii", "Acinetobacter baumannii", "Gram-negative", "extracellular",
     "Multidrug-resistant nosocomial pathogen; survives on hospital surfaces and exhibits remarkable antibiotic resistance. OmpA is a major virulence factor that targets mitochondria to induce host cell death. Plc (phospholipase C) degrades host membrane phospholipids. CsuA/B pilus and Bap surface protein mediate biofilm formation on abiotic surfaces including medical devices",
     "10.1038/s41579-019-0259-0"),
    ("Burkholderia pseudomallei", "Burkholderia pseudomallei", "Gram-negative", "escape",
     "Escapes phagosome via T3SS (T3SS-3); replicates in cytosol; induces actin polymerization for cell-to-cell spread. BopA is a T3SS translocon protein that mediates phagosomal escape, while BopE acts as a GEF for Cdc42 and Rac1 to induce membrane ruffling. BimA recruits actin to the bacterial surface for polymerization-based motility. Causes melioidosis in tropical regions",
     "10.3389/fcimb.2019.00118"),
    ("Burkholderia cenocepacia", "Burkholderia cenocepacia", "Gram-negative", "modified_compartment",
     "Survives in membrane-bound vacuole in macrophages; T6SS and T3SS effectors modulate host cell functions. Bat3 is a T6SS component that mediates effector translocation into host cells. AidA is a T4SS effector that promotes intracellular survival within the vacuole. CblA (cable pilus) and BcaA adhesin mediate binding to host epithelial cells and biofilm formation",
     "10.1111/j.1365-2958.2012.08048.x"),
    ("Bacteroides fragilis", "Bacteroides fragilis", "Gram-negative", "extracellular",
     "Anaerobic commensal and opportunistic pathogen; enterotoxigenic strains produce BFT (B. fragilis toxin) — a zinc-dependent metalloprotease that cleaves E-cadherin, disrupting epithelial tight junctions and activating beta-catenin signaling. PsaA is a protective surface antigen. FimA fimbriae mediate adherence to host cells. SusC is part of the starch utilization system for nutrient acquisition",
     "10.3389/fcimb.2019.00163"),
    ("Treponema pallidum", "Treponema pallidum", "Gram-negative", "extracellular",
     "Highly invasive spirochete causing syphilis; capable of penetrating intact mucous membranes and disseminating throughout the body. TprK undergoes antigenic variation to evade host immune responses. Tp0751 (pallilysin) is a metalloprotease that degrades laminin and fibrinogen for tissue penetration. Has a minimal genome (~1.14 Mbp) with limited metabolic capacity, relying on host nutrients",
     "10.1038/s41579-019-0285-y"),
    ("Borrelia burgdorferi", "Borrelia burgdorferi", "Gram-negative", "extracellular",
     "Lyme disease spirochete transmitted by Ixodes ticks; disseminates through tissue and evades immune clearance. OspA and OspC are differentially expressed surface lipoproteins — OspA promotes tick midgut colonization while OspC is required for mammalian infection. VlsE undergoes segmental gene conversion to generate antigenic variation, enabling persistent infection. DbpA binds decorin for tissue adhesion",
     "10.1038/s41579-019-0306-x"),
    ("Leptospira interrogans", "Leptospira interrogans", "Gram-negative", "extracellular",
     "Leptospirosis spirochete; invades through mucous membranes or skin abrasions; colonizes the renal tubules of reservoir hosts and is shed in urine. LipL32 is the major outer membrane lipoprotein involved in adhesion to host ECM. LenA binds complement Factor H to evade immune killing. Loa22 contains a collagen-binding domain for host tissue adherence. Causes Weil's disease in severe cases",
     "10.3389/fcimb.2019.00107"),
]

# ── Effectors ──────────────────────────────────────────────────────────────

EFFECTORS = [
    # Salmonella enterica (original)
    ("Salmonella enterica", "SopE", "T3SS (SPI-1)", "Cdc42 / Rac1", "GEF for host Rho-family GTPases"),
    ("Salmonella enterica", "SipA", "T3SS (SPI-1)", "Actin", "Binds/stabilizes actin filaments"),
    ("Salmonella enterica", "SopB/SigD", "T3SS (SPI-1)", "PI(4,5)P2", "Phosphatidylinositol phosphatase"),
    ("Salmonella enterica", "SifA", "T3SS (SPI-2)", "SKIP", "Binds SKIP displacing Rab9"),
    ("Salmonella enterica", "PipB2", "T3SS (SPI-2)", "Kinesin-1", "Recruits kinesin-1 to SCV"),
    ("Salmonella enterica", "SseJ", "T3SS (SPI-2)", "Cholesterol", "Acyltransferase"),
    ("Salmonella enterica", "SopD2", "T3SS (SPI-2)", "Rab7", "Suppresses Rab7-dependent recruitment"),

    # Listeria monocytogenes (original)
    ("Listeria monocytogenes", "LLO", "Toxin", "Cholesterol", "Pore-forming cytolysin"),
    ("Listeria monocytogenes", "ActA", "Surface protein", "Arp2/3", "Mimics host WASP"),
    ("Listeria monocytogenes", "InlA", "Invasin", "E-cadherin", "Triggers zipper-mediated entry"),
    ("Listeria monocytogenes", "InlB", "Invasin", "Met receptor", "Triggers PI3K and Rac1 signaling"),
    ("Listeria monocytogenes", "PlcA", "Phospholipase", "PI(4,5)P2", "PI-PLC vacuolar escape"),
    ("Listeria monocytogenes", "PlcB", "Phospholipase", "Phosphatidylcholine", "Broad-range phospholipase"),

    # Mycobacterium tuberculosis (original)
    ("Mycobacterium tuberculosis", "LAM", "Glycolipid", "Vps34", "Inhibits Ca2+ signaling"),
    ("Mycobacterium tuberculosis", "SapM", "Secreted phosphatase", "PI3P", "Dephosphorylates PI3P"),
    ("Mycobacterium tuberculosis", "MptpA", "Secreted phosphatase", "V-ATPase", "Blocks V-ATPase trafficking"),
    ("Mycobacterium tuberculosis", "MptpB", "Secreted phosphatase", "PI(3,5)P2", "Hydrolyzes PI(3,5)P2"),
    ("Mycobacterium tuberculosis", "Eis", "Secreted protein", "JNK/AMPK", "Acetyltransferase; inhibits autophagy"),
    ("Mycobacterium tuberculosis", "PknG", "Ser/Thr kinase", "Rab proteins", "Phosphorylates host Rab GTPases"),
    ("Mycobacterium tuberculosis", "ESAT-6", "T7SS (ESX-1)", "Membrane", "Pore-forming; promotes phagosomal escape"),

    # Legionella pneumophila (original)
    ("Legionella pneumophila", "DrrA/SidM", "T4SS (Dot/Icm)", "Rab1", "GEF and GDF for Rab1; AMPylates"),
    ("Legionella pneumophila", "AnkX", "T4SS (Dot/Icm)", "Rab1 / Rab35", "FIC domain phosphocholinase"),
    ("Legionella pneumophila", "Lem3", "T4SS (Dot/Icm)", "Rab1", "Dephosphocholinase"),
    ("Legionella pneumophila", "SidD", "T4SS (Dot/Icm)", "Rab1", "DeAMPylase"),
    ("Legionella pneumophila", "LidA", "T4SS (Dot/Icm)", "Rab1", "Binds/stabilizes active Rab1"),
    ("Legionella pneumophila", "SidC", "T4SS (Dot/Icm)", "ER membranes", "Recruits ER vesicles to LCV"),
    ("Legionella pneumophila", "VipD", "T4SS (Dot/Icm)", "Endosomal Rab5/Rab22", "Phospholipase A1; displaces from endosomes"),

    # Shigella flexneri (original)
    ("Shigella flexneri", "IpaB", "T3SS (translocon)", "Vacuolar membrane", "Pore-forming translocator"),
    ("Shigella flexneri", "IpaC", "T3SS (translocon)", "Actin", "Induces actin polymerization"),
    ("Shigella flexneri", "IcsA/VirG", "Autotransporter", "N-WASP / Arp2/3", "Recruits N-WASP and Arp2/3"),
    ("Shigella flexneri", "IcsB", "T3SS", "LC3", "Masks IcsA from autophagy receptor"),
    ("Shigella flexneri", "VirA", "T3SS", "Rab1", "Rab1 GAP activity"),
    ("Shigella flexneri", "OspG", "T3SS", "Ubiquitin pathway", "Kinase that inhibits NF-kB"),

    # Brucella abortus
    ("Brucella abortus", "VirB", "T4SS (VirB)", "ER membranes", "Type IV secretion system structural component"),
    ("Brucella abortus", "BtpA", "T4SS effector", "TLR2", "TIR-domain containing; inhibits TLR2 signaling"),
    ("Brucella abortus", "BtpB", "T4SS effector", "TIRAP/Mal", "TIR-domain containing adaptor mimic"),
    ("Brucella abortus", "VceA", "T4SS effector", "Secretory pathway", "Modulates host vesicular trafficking"),
    ("Brucella abortus", "VceC", "T4SS effector", "ER stress response", "Activates unfolded protein response"),

    # Francisella tularensis
    ("Francisella tularensis", "IglC", "T6SS", "Phagosomal membrane", "Essential for phagosomal escape"),
    ("Francisella tularensis", "IglD", "T6SS", "Phagosomal membrane", "Component of T6SS apparatus"),
    ("Francisella tularensis", "IglE", "T6SS", "Vacuole", "Contributes to phagosomal disruption"),
    ("Francisella tularensis", "MglA", "Regulator", "Transcription", "Global virulence regulator"),
    ("Francisella tularensis", "FevR", "Regulator", "PP2C", "Interacts with phosphatase; regulates gene expression"),

    # Coxiella burnetii
    ("Coxiella burnetii", "Cig57", "T4SS (Dot/Icm)", "Clathrin", "Subverts clathrin-mediated trafficking"),
    ("Coxiella burnetii", "Cig2", "T4SS (Dot/Icm)", "Rab proteins", "Interacts with host Rab GTPases"),
    ("Coxiella burnetii", "CvpB", "T4SS (Dot/Icm)", "PI3P / Rab5", "Binds PI3P and Rab5 for CCV biogenesis"),
    ("Coxiella burnetii", "CirA", "T4SS (Dot/Icm)", "Exocyst complex", "Modulates host vesicle tethering"),
    ("Coxiella burnetii", "CirB", "T4SS (Dot/Icm)", "HOPS complex", "Intercepts tethering for CCV expansion"),

    # Yersinia pestis
    ("Yersinia pestis", "YopE", "T3SS (Ysc)", "Rho GTPases", "GAP for RhoA, Rac1, Cdc42"),
    ("Yersinia pestis", "YopH", "T3SS (Ysc)", "FAK / p130Cas", "Potent PTPase; disrupts focal adhesions"),
    ("Yersinia pestis", "YopJ", "T3SS (Ysc)", "MAPKK / IKK", "Acetyltransferase; blocks NF-kB and MAPK"),
    ("Yersinia pestis", "YopM", "T3SS (Ysc)", "PRP kinases", "Leucine-rich repeat; binds thrombin"),
    ("Yersinia pestis", "YopT", "T3SS (Ysc)", "Rho GTPases", "Cysteine protease; cleaves prenylated Rho"),
    ("Yersinia pestis", "LcrV", "T3SS needle tip", "TLR2 / CD14", "Modulates immune response"),

    # Yersinia pseudotuberculosis
    ("Yersinia pseudotuberculosis", "YopE", "T3SS (Ysa/Ysc)", "Rho GTPases", "GAP activity"),
    ("Yersinia pseudotuberculosis", "YopH", "T3SS (Ysa/Ysc)", "FAK / p130Cas", "PTPase; host cell detachment"),
    ("Yersinia pseudotuberculosis", "YopJ", "T3SS (Ysa/Ysc)", "MAPKK", "Blocks inflammatory signaling"),
    ("Yersinia pseudotuberculosis", "YpkA/YopO", "T3SS (Ysa/Ysc)", "Actin / RhoA", "Ser/Thr kinase; actin binding"),

    # Chlamydia trachomatis
    ("Chlamydia trachomatis", "IncA", "T3SS", "SNARE proteins", "Inclusion membrane protein; blocks fusion"),
    ("Chlamydia trachomatis", "IncB", "T3SS", "Rab4", "Recruits Rab4 to inclusion membrane"),
    ("Chlamydia trachomatis", "IncC", "T3SS", "Rab6 / Rab11", "Recruits Golgi-derived vesicles"),
    ("Chlamydia trachomatis", "CT229", "T3SS", "Rab GTPases", "Ubiquitin ligase; Rab protein modification"),
    ("Chlamydia trachomatis", "CT813", "T3SS", "Host membranes", "Inclusion protein; lipid acquisition"),
    ("Chlamydia trachomatis", "CADD", "T3SS", "Host apoptosis", "Anti-apoptotic; blocks host cell death"),

    # Chlamydia pneumoniae
    ("Chlamydia pneumoniae", "IncA", "T3SS", "SNAREs", "Similar inclusion membrane function"),
    ("Chlamydia pneumoniae", "CPn0585", "T3SS", "Rab GTPases", "Guanine nucleotide exchange factor"),
    ("Chlamydia pneumoniae", "CPn0809", "T3SS", "Host membranes", "Sphingolipid acquisition"),

    # Anaplasma phagocytophilum
    ("Anaplasma phagocytophilum", "Ats-1", "T4SS", "Rab5 / PI3P", "Binds Rab5; anchors to inclusion membrane"),
    ("Anaplasma phagocytophilum", "AnkA", "T4SS", "MYADM / Abl-1", "Ankyrin repeat; modulates host signaling"),
    ("Anaplasma phagocytophilum", "p44/Msp2", "Surface protein", "P-selectin glycoprotein", "Antigenic variation; immune evasion"),

    # Ehrlichia chaffeensis
    ("Ehrlichia chaffeensis", "TRP120", "T4SS", "Notch pathway", "Mimics Notch ligand; activates Notch signaling"),
    ("Ehrlichia chaffeensis", "TRP32", "T4SS", "Wnt pathway", "Activates Wnt signaling for host survival"),
    ("Ehrlichia chaffeensis", "Ank200", "T4SS", "Host transcription", "Ankyrin repeat; modulates gene expression"),

    # Bartonella henselae
    ("Bartonella henselae", "BepA", "T4SS (VirB)", "Host cell actin", "F-actin fiber formation; anti-apoptotic"),
    ("Bartonella henselae", "BepB", "T4SS (VirB)", "Host membranes", "Actin remodeling"),
    ("Bartonella henselae", "BepC", "T4SS (VirB)", "PI3K / Akt", "Promotes endothelial cell proliferation"),
    ("Bartonella henselae", "BepD", "T4SS (VirB)", "Host membranes", "F-actin recruitment"),
    ("Bartonella henselae", "BepE", "T4SS (VirB)", "Host apoptosis", "Anti-apoptotic"),

    # Rickettsia rickettsii
    ("Rickettsia rickettsii", "RickA", "Surface protein", "Arp2/3", "Actin polymerization; actin tails"),
    ("Rickettsia rickettsii", "Sca2", "Surface protein", "Actin", "Formin-like actin nucleator"),
    ("Rickettsia rickettsii", "Pat1", "Patatin-like", "Phospholipids", "Phospholipase; phagosomal escape"),
    ("Rickettsia rickettsii", "TlyA", "Hemolysin", "Membrane", "Pore-forming hemolysin"),

    # Rickettsia conorii
    ("Rickettsia conorii", "RickA", "Surface protein", "Arp2/3", "Actin tail formation"),
    ("Rickettsia conorii", "Sca2", "Surface protein", "Actin", "Actin-based motility"),
    ("Rickettsia conorii", "Pat1", "Patatin-like", "Phospholipids", "Membrane disruption"),

    # Salmonella typhi
    ("Salmonella typhi", "SopE", "T3SS (SPI-1)", "Cdc42", "GEF for Cdc42"),
    ("Salmonella typhi", "SifA", "T3SS (SPI-2)", "SKIP", "SCV maintenance"),
    ("Salmonella typhi", "PipB2", "T3SS (SPI-2)", "Kinesin-1", "Recruits kinesin to SCV"),
    ("Salmonella typhi", "SseF", "T3SS (SPI-2)", "Microtubules", "SCV positioning near Golgi"),
    ("Salmonella typhi", "SseG", "T3SS (SPI-2)", "Microtubules", "SCV-Golgi association"),

    # Pseudomonas aeruginosa
    ("Pseudomonas aeruginosa", "ExoU", "T3SS", "Phospholipids", "Phospholipase A2; rapid cell lysis"),
    ("Pseudomonas aeruginosa", "ExoS", "T3SS", "Rho / Ras", "GAP and ADP-ribosyltransferase"),
    ("Pseudomonas aeruginosa", "ExoT", "T3SS", "Cdc42 / Rac1", "GAP and ADP-ribosyltransferase"),
    ("Pseudomonas aeruginosa", "ExoY", "T3SS", "cAMP/cGMP", "Adenylate cyclase; disrupts actin"),
    ("Pseudomonas aeruginosa", "ToxA", "Exotoxin", "EF-2", "ADP-ribosyltransferase; protein synthesis inhibition"),
    ("Pseudomonas aeruginosa", "Alginate", "Exopolysaccharide", "Biofilm", "Mucoid biofilm formation"),

    # Escherichia coli K1
    ("Escherichia coli K1", "IbeA", "Invasin", "Vimentin", "Invasion of brain microvascular endothelial cells"),
    ("Escherichia coli K1", "IbeB", "Invasin", "Host membranes", "Invasion factor"),
    ("Escherichia coli K1", "OmpA", "Outer membrane", "GPI-anchored proteins", "Invasion and intracellular survival"),
    ("Escherichia coli K1", "K1 capsule", "Polysaccharide", "Immune evasion", "Antiphagocytic capsular polysaccharide"),
    ("Escherichia coli K1", "CNF1", "Toxin", "Rho GTPases", "Deamidase; constitutive Rho activation"),

    # Neisseria gonorrhoeae
    ("Neisseria gonorrhoeae", "PorB", "Porin", "Mitochondria", "Voltage-gated porin; inhibits apoptosis"),
    ("Neisseria gonorrhoeae", "Opa", "Adhesin", "CEACAM family", "Carcinoembryonic antigen receptor binding"),
    ("Neisseria gonorrhoeae", "PilE", "Type IV pilin", "CD46", "Twitching motility; adherence"),
    ("Neisseria gonorrhoeae", "Ng-MIP", "Macrophage infectivity", "Host membranes", "Porin activity"),
    ("Neisseria gonorrhoeae", "TspB", "Toxin", "Host cells", "Neisserial toxin"),

    # Neisseria meningitidis
    ("Neisseria meningitidis", "PorA", "Porin", "Host membranes", "Major outer membrane porin"),
    ("Neisseria meningitidis", "PorB", "Porin", "Mitochondria", "Voltage-gated; anti-apoptotic"),
    ("Neisseria meningitidis", "Opca", "Adhesin", "CEACAM/fibronectin", "Adhesion and invasion"),
    ("Neisseria meningitidis", "NadA", "Adhesin", "Host cells", "Neisserial adhesin A"),
    ("Neisseria meningitidis", "FetA", "Iron transporter", "Host iron", "Lactoferrin receptor"),

    # Haemophilus influenzae
    ("Haemophilus influenzae", "Hap", "Autotransporter", "Extracellular matrix", "Serine protease; adherence"),
    ("Haemophilus influenzae", "HMW1", "Adhesin", "Epithelial cells", "High molecular weight adhesin"),
    ("Haemophilus influenzae", "HMW2", "Adhesin", "Epithelial cells", "High molecular weight adhesin"),
    ("Haemophilus influenzae", "Hia", "Adhesin", "Host cells", "Haemophilus IgA protease"),
    ("Haemophilus influenzae", "P5", "OMP", "ICAM-1", "Adherence to activated epithelial cells"),

    # Bordetella pertussis
    ("Bordetella pertussis", "PTx", "AB toxin", "Gi/adenylate cyclase", "Pertussis toxin; ADP-ribosyltransferase"),
    ("Bordetella pertussis", "CyaA", "RTX toxin", "CaM/adenylate cyclase", "Adenylate cyclase toxin; phagocyte entry"),
    ("Bordetella pertussis", "FHA", "Adhesin", "CR3 / integrins", "Filamentous hemagglutinin"),
    ("Bordetella pertussis", "TCF", "Tracheal cytotoxin", "Ciliated cells", "Disrupts ciliated epithelium"),
    ("Bordetella pertussis", "DNT", "Toxin", "Rho GTPases", "Dermonecrotic toxin; constrictive activity"),

    # Vibrio cholerae
    ("Vibrio cholerae", "CTX", "AB toxin", "Gs/adenylate cyclase", "Cholera toxin; ADP-ribosyltransferase"),
    ("Vibrio cholerae", "TCP", "Pilus", "Host intestinal cells", "Toxin-coregulated pilus; colonization"),
    ("Vibrio cholerae", "VSP", "T6SS", "Host cells", "Type VI secretion; effector translocation"),
    ("Vibrio cholerae", "HlyA", "Hemolysin", "Membrane", "Pore-forming cytolysin"),
    ("Vibrio cholerae", "VvpE", "Protease", "Mucin", "Mucinase; biofilm dispersal"),

    # Campylobacter jejuni
    ("Campylobacter jejuni", "Cdt", "Cytolethal distending", "Host DNA", "DNase; cell cycle arrest"),
    ("Campylobacter jejuni", "FlaA", "Flagellin", "TLR5", "Major flagellin; glycosylated"),
    ("Campylobacter jejuni", "CiaB", "Flagellar secretion", "Host cells", "Campylobacter invasion antigen"),
    ("Campylobacter jejuni", "VirK", "Virulence factor", "Host membranes", "Intracellular survival"),
    ("Campylobacter jejuni", "CfrA", "Iron transporter", "Host iron", "Ferric enterobactin receptor"),

    # Helicobacter pylori
    ("Helicobacter pylori", "CagA", "T4SS effector", "SHP-2 / PAR1", "Injected by T4SS; cell signaling disruption"),
    ("Helicobacter pylori", "VacA", "Pore-forming toxin", "Mitochondria / lysosomes", "Vacuolating cytotoxin"),
    ("Helicobacter pylori", "UreA", "Urease", "Stomach acid", "Neutralizes gastric pH"),
    ("Helicobacter pylori", "HtrA", "Serine protease", "E-cadherin", "Cleaves E-cadherin; disrupts junctions"),
    ("Helicobacter pylori", "OipA", "Outer membrane", "IL-8 induction", "Inflammatory activation"),

    # Orientia tsutsugamushi
    ("Orientia tsutsugamushi", "ScaA", "Autotransporter", "Host cell adhesion", "Surface cell antigen A"),
    ("Orientia tsutsugamushi", "ScaC", "Autotransporter", "Host cell adhesion", "Surface cell antigen C"),
    ("Orientia tsutsugamushi", "HlyA", "Hemolysin", "Membrane", "Putative hemolysin for escape"),
    ("Orientia tsutsugamushi", "Pld", "Phospholipase D", "Host membranes", "Phagosomal escape"),
    ("Orientia tsutsugamushi", "Tsa56", "Surface protein", "Host immune evasion", "Major outer membrane protein"),

    # Staphylococcus aureus
    ("Staphylococcus aureus", "Hla", "Pore-forming toxin", "ADAM10", "Alpha-hemolysin; heptameric pore"),
    ("Staphylococcus aureus", "Hlb", "Sphingomyelinase", "Sphingomyelin", "Beta-hemolysin; SM hydrolysis"),
    ("Staphylococcus aureus", "PVL", "Pore-forming toxin", "C5aR / CD88", "Panton-Valentine leukocidin"),
    ("Staphylococcus aureus", "SpA", "Surface protein", "IgG / VH3", "Protein A; antibody binding"),
    ("Staphylococcus aureus", "Efb", "Secreted protein", "Fibrinogen", "Immune evasion; clot formation"),

    # Streptococcus pyogenes
    ("Streptococcus pyogenes", "SLO", "Cholesterol-dependent", "Cholesterol", "Streptolysin O; phagosomal escape"),
    ("Streptococcus pyogenes", "SLS", "Pore-forming", "Membrane", "Streptolysin S; hemolytic"),
    ("Streptococcus pyogenes", "SpeB", "Cysteine protease", "Host proteins", "Degrades extracellular matrix"),
    ("Streptococcus pyogenes", "M protein", "Surface protein", "Factor H / C4BP", "Antiphagocytic; binds complement"),
    ("Streptococcus pyogenes", "SpeA", "Superantigen", "MHC II / TCR", "Streptococcal pyrogenic exotoxin A"),

    # Streptococcus pneumoniae
    ("Streptococcus pneumoniae", "PLY", "Cholesterol-dependent", "Cholesterol", "Pneumolysin; pore-forming toxin"),
    ("Streptococcus pneumoniae", "PspA", "Surface protein", "Lactoferrin", "Pneumococcal surface protein A"),
    ("Streptococcus pneumoniae", "PspC", "Surface protein", "Factor H", "Complement evasion"),
    ("Streptococcus pneumoniae", "LytA", "Amidase", "Peptidoglycan", "Autolysin; biofilm release"),
    ("Streptococcus pneumoniae", "NanA", "Neuraminidase", "Sialic acid", "Cleaves host sialic acid"),

    # Bacillus anthracis
    ("Bacillus anthracis", "ALO", "Cholesterol-dependent", "Cholesterol", "Anthrolysin O; phagosomal escape"),
    ("Bacillus anthracis", "LF", "AB toxin", "MAPKKs", "Lethal factor; zinc metalloprotease"),
    ("Bacillus anthracis", "EF", "AB toxin", "CaM/adenylate cyclase", "Edema factor; adenylyl cyclase"),
    ("Bacillus anthracis", "PA", "AB toxin", "ANTXR1/2", "Protective antigen; mediates uptake of LF/EF"),
    ("Bacillus anthracis", "CatB", "Catalase", "ROS", "Resistance to oxidative burst"),

    # Bacillus cereus
    ("Bacillus cereus", "Hbl", "Pore-forming", "Membrane", "Hemolysin BL; three-component toxin"),
    ("Bacillus cereus", "Nhe", "Pore-forming", "Membrane", "Non-hemolytic enterotoxin"),
    ("Bacillus cereus", "CytK", "Pore-forming", "Membrane", "Cytotoxin K; beta-barrel pore"),
    ("Bacillus cereus", "PC-PLC", "Phospholipase", "Membrane", "Phosphatidylcholine-hydrolyzing"),

    # Clostridium perfringens
    ("Clostridium perfringens", "CTA", "AB toxin (CPE)", "Claudins", "C. perfringens enterotoxin; tight junction"),
    ("Clostridium perfringens", "PFO", "Cholesterol-dependent", "Cholesterol", "Perfringolysin O; pore-forming"),
    ("Clostridium perfringens", "PLC", "Phospholipase", "Membrane", "Alpha-toxin; hemolysis and necrosis"),
    ("Clostridium perfringens", "NetB", "Pore-forming", "Host cells", "Necrotic enteritis toxin B"),

    # Clostridium difficile
    ("Clostridium difficile", "TcdA", "Large clostridial toxin", "Rho GTPases", "Enterotoxin; glucosyltransferase"),
    ("Clostridium difficile", "TcdB", "Large clostridial toxin", "Rho GTPases", "Cytotoxin; glucosyltransferase"),
    ("Clostridium difficile", "Cdt", "ADP-ribosyltransferase", "Actin", "Binary toxin; actin depolymerization"),
    ("Clostridium difficile", "FliC", "Flagellin", "TLR5", "Flagellar protein; inflammatory"),

    # Enterococcus faecalis
    ("Enterococcus faecalis", "Cyl", "Pore-forming toxin", "Membrane", "Cytolysin; hemolytic/bactericidal"),
    ("Enterococcus faecalis", "Esp", "Surface protein", "Host cells", "Enterococcal surface protein; biofilm"),
    ("Enterococcus faecalis", "GelE", "Gelatinase", "ECM proteins", "Extracellular protease"),
    ("Enterococcus faecalis", "SprE", "Serine protease", "Host proteins", "Immune evasion factor"),
    ("Enterococcus faecalis", "Ace", "Adhesin", "Collagen", "Adherence to collagen"),

    # Corynebacterium diphtheriae
    ("Corynebacterium diphtheriae", "DT", "AB toxin", "EF-2", "Diphtheria toxin; ADP-ribosyltransferase"),
    ("Corynebacterium diphtheriae", "Fbp", "Iron transporter", "Host iron", "Iron acquisition"),
    ("Corynebacterium diphtheriae", "SpaA", "Pilin", "Host cells", "Shaft pilin; adherence"),
    ("Corynebacterium diphtheriae", "SpaB", "Pilin", "Host cells", "Minor pilin; adherence"),

    # Nocardia asteroides
    ("Nocardia asteroides", "Mce", "Mammalian cell entry", "Host membranes", "Invasion and survival"),
    ("Nocardia asteroides", "PLA", "Phospholipase", "Host membranes", "Phagosomal escape factor"),
    ("Nocardia asteroides", "Sod", "Superoxide dismutase", "ROS", "Oxidative stress resistance"),
    ("Nocardia asteroides", "Cat", "Catalase", "H2O2", "Hydrogen peroxide resistance"),

    # Rhodococcus equi
    ("Rhodococcus equi", "VapA", "Surface protein", "Host membranes", "Virulence-associated protein; phagosome survival"),
    ("Rhodococcus equi", "VapB", "Surface protein", "Host membranes", "Alternative Vap variant"),
    ("Rhodococcus equi", "VapC", "Surface protein", "Host membranes", "Vap family member"),
    ("Rhodococcus equi", "VapD", "Surface protein", "Host membranes", "Vap family member"),

    # Tropheryma whipplei
    ("Tropheryma whipplei", "TW1", "Surface protein", "Host cells", "Adhesion factor"),
    ("Tropheryma whipplei", "TW2", "Surface protein", "Macrophages", "Intracellular survival"),
    ("Tropheryma whipplei", "TW3", "Surface protein", "Immune modulation", "Modulates host immune response"),

    # Mycobacterium leprae
    ("Mycobacterium leprae", "LAM", "Glycolipid", "Vps34", "Similar to M. tuberculosis"),
    ("Mycobacterium leprae", "ML0098", "Secreted protein", "Host signaling", "Modulates TLR signaling"),
    ("Mycobacterium leprae", "ML0840", "Secreted protein", "Host cells", "Putative virulence factor"),
    ("Mycobacterium leprae", "ML2499", "Surface protein", "Schwann cells", "Adhesion to Schwann cells"),

    # Mycobacterium bovis
    ("Mycobacterium bovis", "LAM", "Glycolipid", "Vps34", "Lipoarabinomannan"),
    ("Mycobacterium bovis", "ESAT-6", "T7SS (ESX-1)", "Membrane", "Early secretory antigenic target"),
    ("Mycobacterium bovis", "CFP-10", "T7SS (ESX-1)", "Host cells", "Culture filtrate protein 10"),
    ("Mycobacterium bovis", "MPB70", "Secreted protein", "Host immune", "Major secreted antigen"),

    # Mycobacterium avium
    ("Mycobacterium avium", "LAM", "Glycolipid", "Vps34", "Lipoarabinomannan; blocks signaling"),
    ("Mycobacterium avium", "MAV_2941", "Secreted protein", "Host cells", "Intracellular survival factor"),

    # Mycobacterium marinum
    ("Mycobacterium marinum", "LAM", "Glycolipid", "Vps34", "Lipoarabinomannan"),
    ("Mycobacterium marinum", "ESAT-6", "T7SS (ESX-1)", "Membrane", "Pore-forming; phagosomal permeabilization"),
    ("Mycobacterium marinum", "MMPL7", "Transport protein", "Drug resistance", "Efflux pump"),

    # Streptomyces scabies
    ("Streptomyces scabies", "TxtA", "Synthetase", "Plant cells", "Thaxtomin A biosynthesis; cellulose inhibition"),
    ("Streptomyces scabies", "TxtB", "Synthetase", "Plant cells", "Thaxtomin A biosynthesis"),
    ("Streptomyces scabies", "TxtC", "Synthetase", "Plant cells", "Thaxtomin A biosynthesis"),
    ("Streptomyces scabies", "Nec1", "Virulence factor", "Plant tissues", "Necrosis-inducing protein"),

    # Porphyromonas gingivalis
    ("Porphyromonas gingivalis", "RgpA", "Cysteine protease", "Host proteins", "Arginine-gingipain A"),
    ("Porphyromonas gingivalis", "RgpB", "Cysteine protease", "Host proteins", "Arginine-gingipain B"),
    ("Porphyromonas gingivalis", "Kgp", "Cysteine protease", "Host proteins", "Lysine-gingipain"),
    ("Porphyromonas gingivalis", "FimA", "Fimbriae", "CD14/TLR2", "Major fimbrial subunit; adhesion"),
    ("Porphyromonas gingivalis", "HagA", "Hemagglutinin", "Host cells", "Hemagglutinin A"),

    # Klebsiella pneumoniae
    ("Klebsiella pneumoniae", "CPS", "Polysaccharide", "Immune evasion", "Capsular polysaccharide; antiphagocytic"),
    ("Klebsiella pneumoniae", "LPS", "Lipopolysaccharide", "TLR4", "Endotoxin; inflammatory"),
    ("Klebsiella pneumoniae", "FimH", "Fimbrial adhesin", "Mannose receptors", "Type 1 fimbriae; adhesion"),
    ("Klebsiella pneumoniae", "MrkD", "Fimbrial adhesin", "Extracellular matrix", "Type 3 fimbriae; biofilm"),
    ("Klebsiella pneumoniae", "KPC", "Beta-lactamase", "Antibiotics", "Carbapenem resistance"),

    # Acinetobacter baumannii
    ("Acinetobacter baumannii", "OmpA", "Outer membrane", "Mitochondria", "Porin; targeting host cell death"),
    ("Acinetobacter baumannii", "AbOmpA", "Outer membrane", "Host membranes", "Biofilm-associated protein"),
    ("Acinetobacter baumannii", "CsuA/B", "Pilus", "Abiotic surfaces", "Biofilm formation"),
    ("Acinetobacter baumannii", "Bap", "Surface protein", "Host cells", "Biofilm-associated protein"),
    ("Acinetobacter baumannii", "Plc", "Phospholipase", "Host membranes", "Phospholipase C activity"),

    # Burkholderia pseudomallei
    ("Burkholderia pseudomallei", "BopA", "T3SS (T3SS-3)", "Host membranes", "Translocon; phagosomal escape"),
    ("Burkholderia pseudomallei", "BopE", "T3SS (T3SS-3)", "Cdc42 / Rac1", "GEF for Rho GTPases"),
    ("Burkholderia pseudomallei", "BprP", "Protease", "Host proteins", "Serine protease"),
    ("Burkholderia pseudomallei", "BimA", "Surface protein", "Actin", "Actin-based motility"),
    ("Burkholderia pseudomallei", "MprA", "Protease", "Host proteins", "Metalloprotease"),

    # Burkholderia cenocepacia
    ("Burkholderia cenocepacia", "Bat3", "T6SS", "Host cells", "T6SS component"),
    ("Burkholderia cenocepacia", "AidA", "T4SS effector", "Host membranes", "Intracellular survival"),
    ("Burkholderia cenocepacia", "CblA", "Cable pilus", "Host cells", "Adhesion factor"),
    ("Burkholderia cenocepacia", "BcaA", "Adhesin", "Host cells", "Burkholderia adhesin"),

    # Bacteroides fragilis
    ("Bacteroides fragilis", "BFT", "Metalloprotease", "E-cadherin", "B. fragilis toxin; epithelial signaling"),
    ("Bacteroides fragilis", "PsaA", "Surface protein", "Host cells", "Protection surface antigen"),
    ("Bacteroides fragilis", "FimA", "Fimbriae", "Host cells", "Type A fimbriae"),
    ("Bacteroides fragilis", "SusC", "Nutrient transporter", "Host glycans", "Starch utilization"),

    # Treponema pallidum
    ("Treponema pallidum", "TprK", "Surface protein", "Immune evasion", "Antigenic variation; VMP-like"),
    ("Treponema pallidum", "Tp0751", "Pallilysin", "Laminin / fibrinogen", "Metalloprotease; tissue penetration"),
    ("Treponema pallidum", "Tp0483", "Membrane protein", "Host cells", "Cytoplasmic membrane protein"),
    ("Treponema pallidum", "FlaA", "Flagellin", "Host tissue", "Periplasmic flagellar sheath"),

    # Borrelia burgdorferi
    ("Borrelia burgdorferi", "OspA", "Surface lipoprotein", "TLR2", "Outer surface protein A"),
    ("Borrelia burgdorferi", "OspC", "Surface lipoprotein", "Host immune", "Outer surface protein C"),
    ("Borrelia burgdorferi", "VlsE", "Surface protein", "Immune evasion", "Antigenic variation locus"),
    ("Borrelia burgdorferi", "DbpA", "Adhesin", "Decorin", "PAS domain; decorin-binding"),

    # Leptospira interrogans
    ("Leptospira interrogans", "LipL32", "Surface lipoprotein", "Host cells", "Major outer membrane protein"),
    ("Leptospira interrogans", "LipL41", "Surface lipoprotein", "Host cells", "Minor outer membrane protein"),
    ("Leptospira interrogans", "Loa22", "Surface protein", "Collagen", "Adhesion to host ECM"),
    ("Leptospira interrogans", "LenA", "Surface protein", "Complement", "Factor H binding"),
]


def write_csv(filename, fieldnames, rows):
    path = SEED_DIR / filename
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(dict(zip(fieldnames, row)))
    print(f"  Wrote {len(rows)} rows to {filename}")


def generate_all():
    print("Generating seed data...")
    write_csv("pathogens.csv",
        ["name", "species", "gram_stain", "strategy", "description", "reference"],
        [(n, s, g, st, d, r) for (n, s, g, st, d, r) in PATHOGENS])
    write_csv("effectors.csv",
        ["pathogen_name", "effector_name", "type", "host_target", "mechanism"],
        [e for e in EFFECTORS])
    write_csv("host_proteins.csv",
        ["name", "full_name", "function", "localization", "pathway"],
        [(n, f, fn, loc, p) for (n, f, fn, loc, p) in HOST_PROTEINS])
    write_csv("effector_targets.csv",
        ["pathogen_name", "effector_name", "host_protein_name", "interaction_type"],
        [t for t in EFFECTOR_TARGETS])
    print("Done!")


# ── Host proteins ──────────────────────────────────────────────────────────

HOST_PROTEINS = [
    # Original 32 (keeping all)
    ("Cdc42", "Cell division control protein 42", "Rho GTPase regulating actin dynamics", "Cytosol/membrane", "Actin polymerization"),
    ("Rac1", "Ras-related C3 botulinum toxin substrate 1", "Regulates membrane ruffling and cell motility", "Membrane", "Actin polymerization"),
    ("Actin", "Actin", "Cytoskeletal protein forming microfilaments", "Cytoskeleton", "Actin polymerization"),
    ("PI(4,5)P2", "Phosphatidylinositol 4,5-bisphosphate", "Membrane signaling phospholipid", "Plasma membrane", "Phosphoinositide signaling"),
    ("SKIP", "SifA and kinesin-interacting protein", "Plekhm1; regulates Rab9 localization", "Cytosol", "Vesicular transport"),
    ("Kinesin-1", "Kinesin heavy chain", "Microtubule motor protein", "Microtubules", "Vesicular transport"),
    ("Cholesterol", "Cholesterol", "Membrane lipid; enriched in lipid rafts", "Membrane", "Lipid metabolism"),
    ("Rab7", "Ras-related protein Rab-7", "Late endosome GTPase regulating lysosomal fusion", "Late endosomes", "Vesicular transport"),
    ("Arp2/3", "Actin-related protein 2/3 complex", "Actin nucleation complex", "Cytoskeleton", "Actin polymerization"),
    ("E-cadherin", "Epithelial cadherin", "Cell-cell adhesion glycoprotein", "Adherens junctions", "Cell adhesion"),
    ("Met receptor", "Hepatocyte growth factor receptor", "Receptor tyrosine kinase", "Plasma membrane", "Receptor signaling"),
    ("Vps34", "Phosphatidylinositol 3-kinase class III", "Generates PI3P for phagosome maturation", "Endosomes", "Phosphoinositide signaling"),
    ("PI3P", "Phosphatidylinositol 3-phosphate", "Early endosome signaling lipid", "Early endosomes", "Phosphoinositide signaling"),
    ("V-ATPase", "Vacuolar-type H+-ATPase", "Proton pump for phagosomal acidification", "Phagosome/lysosome", "Acidification"),
    ("PI(3,5)P2", "Phosphatidylinositol 3,5-bisphosphate", "Late endosome signaling lipid", "Late endosomes", "Phosphoinositide signaling"),
    ("Rab1", "Ras-related protein Rab-1", "ER-to-Golgi vesicular transport GTPase", "ER/Golgi", "Vesicular transport"),
    ("Rab35", "Ras-related protein Rab-35", "Endocytic recycling GTPase", "Plasma membrane/endosomes", "Endocytic recycling"),
    ("N-WASP", "Neural Wiskott-Aldrich syndrome protein", "Actin nucleation promoter", "Cytosol", "Actin polymerization"),
    ("LC3", "Microtubule-associated protein 1A/1B-light chain 3", "Autophagosomal marker protein", "Autophagosome", "Autophagy"),
    ("EEA1", "Early endosome antigen 1", "Early endosome tethering factor", "Early endosomes", "Vesicular transport"),
    ("Rab5", "Ras-related protein Rab-5", "Early endosome GTPase", "Early endosomes", "Vesicular transport"),
    ("LAMP1", "Lysosomal-associated membrane protein 1", "Lysosomal membrane glycoprotein", "Lysosomes", "Lysosome biogenesis"),
    ("RILP", "Rab-interacting lysosomal protein", "Regulates lysosomal positioning", "Late endosomes/lysosomes", "Vesicular transport"),
    ("M6PR", "Mannose-6-phosphate receptor", "Lysosomal enzyme trafficking", "Trans-Golgi/endosomes", "Endocytic recycling"),
    ("VAMP8", "Vesicle-associated membrane protein 8", "Endosomal/vacuolar SNARE", "Lysosomes", "Vesicular transport"),
    ("PIKfyve", "FYVE finger-containing phosphoinositide kinase", "Generates PI(3,5)P2 from PI3P", "Endosomes", "Phosphoinositide signaling"),
    ("SNAP-29", "Synaptosomal-associated protein 29", "Autophagosome-lysosome SNARE", "Cytosol", "Vesicular transport"),
    ("Cathepsin D", "Cathepsin D", "Lysosomal aspartyl protease", "Lysosomes", "Proteolysis"),
    ("NADPH oxidase", "NADPH oxidase 2 (gp91phox)", "Superoxide-generating enzyme", "Phagosome membrane", "Oxidative burst"),
    ("Rab9", "Ras-related protein Rab-9", "Late endosome-to-Golgi transport GTPase", "Late endosomes", "Retrograde transport"),
    ("TNF-alpha", "Tumor necrosis factor alpha", "Pro-inflammatory cytokine", "Secreted", "Immune signaling"),
    ("IL-1beta", "Interleukin-1 beta", "Pro-inflammatory cytokine", "Secreted", "Immune signaling"),
    # New host proteins
    ("RhoA", "Ras homolog family member A", "Rho GTPase; stress fiber formation", "Cytosol/membrane", "Actin polymerization"),
    ("FAK", "Focal adhesion kinase", "Tyrosine kinase; integrin signaling", "Focal adhesions", "Cell adhesion"),
    ("p130Cas", "Crk-associated substrate", "Focal adhesion adaptor protein", "Focal adhesions", "Cell adhesion"),
    ("MAPKK", "MAPK kinase", "ERK/JNK/p38 pathway kinase", "Cytosol", "Receptor signaling"),
    ("IKK", "I-kappa-B kinase", "NF-kB pathway kinase", "Cytosol", "Immune signaling"),
    ("TLR2", "Toll-like receptor 2", "Pattern recognition receptor", "Plasma membrane", "Immune signaling"),
    ("TLR4", "Toll-like receptor 4", "Pattern recognition receptor for LPS", "Plasma membrane", "Immune signaling"),
    ("TLR5", "Toll-like receptor 5", "Flagellin receptor", "Plasma membrane", "Immune signaling"),
    ("ADAM10", "A disintegrin and metalloprotease domain 10", "Metalloprotease; Hla receptor", "Plasma membrane", "Receptor signaling"),
    ("C5aR", "C5 anaphylatoxin receptor (CD88)", "Complement receptor", "Plasma membrane", "Immune signaling"),
    ("Factor H", "Complement factor H", "Complement pathway regulator", "Serum", "Immune signaling"),
    ("C4BP", "C4b-binding protein", "Complement pathway inhibitor", "Serum", "Immune signaling"),
    ("SHP-2", "SH2 domain-containing tyrosine phosphatase 2", "Tyrosine phosphatase", "Cytosol", "Receptor signaling"),
    ("EF-2", "Elongation factor 2", "Ribosomal translocation during protein synthesis", "Cytosol", "Protein synthesis"),
    ("CaM", "Calmodulin", "Calcium-binding messenger protein", "Cytosol", "Calcium signaling"),
    ("Sphingomyelin", "Sphingomyelin", "Membrane lipid", "Membrane", "Lipid metabolism"),
    ("Claudins", "Claudin family", "Tight junction transmembrane proteins", "Tight junctions", "Cell adhesion"),
    ("ICAM-1", "Intercellular adhesion molecule 1", "Leukocyte adhesion receptor", "Plasma membrane", "Cell adhesion"),
    ("CD46", "Membrane cofactor protein (CD46)", "Complement regulatory protein", "Plasma membrane", "Immune signaling"),
    ("CEACAM", "Carcinoembryonic antigen-related cell adhesion molecule", "Cell adhesion molecule", "Plasma membrane", "Cell adhesion"),
    ("Vimentin", "Vimentin", "Intermediate filament protein", "Cytoskeleton", "Cytoskeletal organization"),
    ("GPI anchor", "Glycosylphosphatidylinositol anchor", "Membrane anchoring mechanism", "Plasma membrane", "Membrane anchoring"),
    ("Golgi", "Golgi apparatus", "Secretory pathway organelle", "Golgi", "Secretory pathway"),
    ("ER membrane", "Endoplasmic reticulum membrane", "ER-derived membrane compartment", "ER", "Secretory pathway"),
    ("Mitochondria", "Mitochondrion", "Mitochondrial membrane and matrix", "Mitochondria", "Apoptosis"),
    ("Host DNA", "Host genomic DNA", "DNA damage target", "Nucleus", "Cell cycle"),
    ("Extracellular matrix", "Extracellular matrix proteins", "ECM structural components", "ECM", "Cell adhesion"),
    ("Fibrinogen", "Fibrinogen", "Blood coagulation factor", "Serum", "Immune evasion"),
    ("Lactoferrin", "Lactoferrin", "Iron-binding glycoprotein", "Secreted", "Iron homeostasis"),
    ("Host cells", "Host cell surface receptors", "General host cell targets", "Plasma membrane", "Cell adhesion"),
    ("MHC II", "Major histocompatibility complex class II", "Antigen presentation", "Plasma membrane/endosomes", "Immune signaling"),
    ("Host membranes", "Host cell membranes", "General membrane disruption targets", "Membrane", "Membrane disruption"),
    ("Host immune", "Host immune system", "Immune evasion targets", "Various", "Immune signaling"),
    ("Host signaling", "Host cell signaling pathways", "Signaling pathway modulation", "Cytosol/nucleus", "Receptor signaling"),
    ("Host iron", "Host iron/heme compounds", "Iron acquisition targets", "Serum/tissues", "Iron homeostasis"),
    ("Collagen", "Collagen", "Extracellular matrix structural protein", "ECM", "Cell adhesion"),
    ("Microtubules", "Microtubules", "Cytoskeletal filaments for vesicular transport", "Cytoskeleton", "Vesicular transport"),
    ("Ubiquitin", "Ubiquitin", "Protein degradation tag; autophagy signaling", "Cytosol/nucleus", "Autophagy"),
    ("Notch", "Notch receptor", "Cell-fate determination receptor", "Plasma membrane", "Receptor signaling"),
    ("Wnt", "Wnt signaling components", "Developmental signaling pathway", "Cytosol/nucleus", "Receptor signaling"),
]

# ── Effector-target mappings ──────────────────────────────────────────────

EFFECTOR_TARGETS = [
    # Salmonella enterica
    ("Salmonella enterica", "SopE", "Cdc42", "GEF"),
    ("Salmonella enterica", "SopE", "Rac1", "GEF"),
    ("Salmonella enterica", "SipA", "Actin", "binds/stabilizes"),
    ("Salmonella enterica", "SopB/SigD", "PI(4,5)P2", "dephosphorylates"),
    ("Salmonella enterica", "SifA", "SKIP", "binds"),
    ("Salmonella enterica", "PipB2", "Kinesin-1", "recruits"),
    ("Salmonella enterica", "SseJ", "Cholesterol", "acyltransferase"),
    ("Salmonella enterica", "SopD2", "Rab7", "inhibits"),

    # Listeria monocytogenes
    ("Listeria monocytogenes", "LLO", "Cholesterol", "pore-forming"),
    ("Listeria monocytogenes", "ActA", "Arp2/3", "activates"),
    ("Listeria monocytogenes", "InlA", "E-cadherin", "binds"),
    ("Listeria monocytogenes", "InlB", "Met receptor", "activates"),
    ("Listeria monocytogenes", "PlcA", "PI(4,5)P2", "hydrolyzes"),
    ("Listeria monocytogenes", "PlcB", "Sphingomyelin", "hydrolyzes"),

    # Mycobacterium tuberculosis
    ("Mycobacterium tuberculosis", "LAM", "Vps34", "inhibits"),
    ("Mycobacterium tuberculosis", "SapM", "PI3P", "dephosphorylates"),
    ("Mycobacterium tuberculosis", "MptpA", "V-ATPase", "blocks"),
    ("Mycobacterium tuberculosis", "MptpB", "PI(3,5)P2", "hydrolyzes"),
    ("Mycobacterium tuberculosis", "Eis", "Host signaling", "acetylates"),
    ("Mycobacterium tuberculosis", "PknG", "Host signaling", "phosphorylates"),

    # Legionella pneumophila
    ("Legionella pneumophila", "DrrA/SidM", "Rab1", "GEF"),
    ("Legionella pneumophila", "AnkX", "Rab1", "phosphocholinates"),
    ("Legionella pneumophila", "AnkX", "Rab35", "phosphocholinates"),
    ("Legionella pneumophila", "Lem3", "Rab1", "dephosphocholinates"),
    ("Legionella pneumophila", "SidD", "Rab1", "deAMPylates"),
    ("Legionella pneumophila", "LidA", "Rab1", "binds/stabilizes"),
    ("Legionella pneumophila", "SidC", "ER membrane", "recruits"),
    ("Legionella pneumophila", "VipD", "Host membranes", "phospholipase"),

    # Shigella flexneri
    ("Shigella flexneri", "IpaB", "Host membranes", "pore-forming"),
    ("Shigella flexneri", "IpaC", "Actin", "nucleates"),
    ("Shigella flexneri", "IcsA/VirG", "N-WASP", "recruits"),
    ("Shigella flexneri", "IcsB", "LC3", "masks"),
    ("Shigella flexneri", "VirA", "Rab1", "GAP"),
    ("Shigella flexneri", "OspG", "Host signaling", "inhibits"),

    # Brucella abortus
    ("Brucella abortus", "VirB", "ER membrane", "modulates"),
    ("Brucella abortus", "BtpA", "TLR2", "inhibits"),
    ("Brucella abortus", "BtpB", "Host signaling", "inhibits"),
    ("Brucella abortus", "VceA", "Golgi", "modulates"),
    ("Brucella abortus", "VceC", "ER membrane", "activates"),

    # Francisella tularensis
    ("Francisella tularensis", "IglC", "Host membranes", "disrupts"),
    ("Francisella tularensis", "IglD", "Host membranes", "disrupts"),

    # Coxiella burnetii
    ("Coxiella burnetii", "Cig57", "Host membranes", "recruits"),
    ("Coxiella burnetii", "Cig2", "Rab1", "binds"),
    ("Coxiella burnetii", "CvpB", "PI3P", "binds"),

    # Yersinia pestis
    ("Yersinia pestis", "YopE", "RhoA", "GAP"),
    ("Yersinia pestis", "YopE", "Rac1", "GAP"),
    ("Yersinia pestis", "YopE", "Cdc42", "GAP"),
    ("Yersinia pestis", "YopH", "FAK", "dephosphorylates"),
    ("Yersinia pestis", "YopH", "p130Cas", "dephosphorylates"),
    ("Yersinia pestis", "YopJ", "MAPKK", "acetylates"),
    ("Yersinia pestis", "YopJ", "IKK", "acetylates"),

    # Yersinia pseudotuberculosis
    ("Yersinia pseudotuberculosis", "YopE", "RhoA", "GAP"),
    ("Yersinia pseudotuberculosis", "YopE", "Rac1", "GAP"),
    ("Yersinia pseudotuberculosis", "YopH", "FAK", "dephosphorylates"),
    ("Yersinia pseudotuberculosis", "YopJ", "MAPKK", "acetylates"),
    ("Yersinia pseudotuberculosis", "YpkA/YopO", "Actin", "binds"),

    # Chlamydia trachomatis
    ("Chlamydia trachomatis", "IncA", "LAMP1", "blocks fusion"),
    ("Chlamydia trachomatis", "IncB", "Rab4", "recruits"),
    ("Chlamydia trachomatis", "IncC", "Golgi", "recruits"),
    ("Chlamydia trachomatis", "CT229", "Host signaling", "modifies"),

    # Staphylococcus aureus
    ("Staphylococcus aureus", "Hla", "ADAM10", "binds"),
    ("Staphylococcus aureus", "PVL", "C5aR", "binds"),
    ("Staphylococcus aureus", "SpA", "MHC II", "binds"),
    ("Staphylococcus aureus", "Efb", "Fibrinogen", "binds"),

    # Streptococcus pyogenes
    ("Streptococcus pyogenes", "SLO", "Cholesterol", "pore-forming"),
    ("Streptococcus pyogenes", "M protein", "Factor H", "binds"),
    ("Streptococcus pyogenes", "M protein", "C4BP", "binds"),
    ("Streptococcus pyogenes", "SpeA", "MHC II", "superantigen"),

    # Streptococcus pneumoniae
    ("Streptococcus pneumoniae", "PLY", "Cholesterol", "pore-forming"),
    ("Streptococcus pneumoniae", "PspA", "Lactoferrin", "binds"),
    ("Streptococcus pneumoniae", "PspC", "Factor H", "binds"),

    # Bacillus anthracis
    ("Bacillus anthracis", "ALO", "Cholesterol", "pore-forming"),
    ("Bacillus anthracis", "LF", "MAPKK", "cleaves"),
    ("Bacillus anthracis", "EF", "CaM", "binds"),
    ("Bacillus anthracis", "PA", "Host cells", "binds"),

    # Clostridium perfringens
    ("Clostridium perfringens", "PFO", "Cholesterol", "pore-forming"),

    # Clostridium difficile
    ("Clostridium difficile", "TcdA", "RhoA", "glucosylates"),
    ("Clostridium difficile", "TcdB", "RhoA", "glucosylates"),
    ("Clostridium difficile", "Cdt", "Actin", "ADP-ribosylates"),

    # Pseudomonas aeruginosa
    ("Pseudomonas aeruginosa", "ExoU", "Host membranes", "phospholipase"),
    ("Pseudomonas aeruginosa", "ExoS", "RhoA", "GAP"),
    ("Pseudomonas aeruginosa", "ExoS", "Ras", "ADP-ribosylates"),
    ("Pseudomonas aeruginosa", "ExoT", "Cdc42", "GAP"),
    ("Pseudomonas aeruginosa", "ExoT", "Rac1", "GAP"),
    ("Pseudomonas aeruginosa", "ToxA", "EF-2", "ADP-ribosylates"),

    # Bordetella pertussis
    ("Bordetella pertussis", "PTx", "Host signaling", "ADP-ribosylates"),
    ("Bordetella pertussis", "CyaA", "CaM", "activates"),

    # Vibrio cholerae
    ("Vibrio cholerae", "CTX", "Host signaling", "ADP-ribosylates"),

    # Helicobacter pylori
    ("Helicobacter pylori", "CagA", "SHP-2", "activates"),
    ("Helicobacter pylori", "VacA", "Mitochondria", "targets"),
    ("Helicobacter pylori", "HtrA", "E-cadherin", "cleaves"),

    # Rickettsia rickettsii
    ("Rickettsia rickettsii", "RickA", "Arp2/3", "activates"),
    ("Rickettsia rickettsii", "Sca2", "Actin", "nucleates"),
    ("Rickettsia rickettsii", "TlyA", "Host membranes", "pore-forming"),

    # Burkholderia pseudomallei
    ("Burkholderia pseudomallei", "BopA", "Host membranes", "disrupts"),
    ("Burkholderia pseudomallei", "BopE", "Cdc42", "GEF"),
    ("Burkholderia pseudomallei", "BopE", "Rac1", "GEF"),
    ("Burkholderia pseudomallei", "BimA", "Actin", "nucleates"),

    # Anaplasma phagocytophilum
    ("Anaplasma phagocytophilum", "Ats-1", "Rab5", "binds"),
    ("Anaplasma phagocytophilum", "Ats-1", "PI3P", "binds"),

    # Bartonella henselae
    ("Bartonella henselae", "BepA", "Actin", "remodels"),

    # Mycobacterium leprae
    ("Mycobacterium leprae", "LAM", "Vps34", "inhibits"),

    # Porphyromonas gingivalis
    ("Porphyromonas gingivalis", "FimA", "TLR2", "binds"),

    # ── Chlamydia pneumoniae (reroute)
    ("Chlamydia pneumoniae", "IncA", "LAMP1", "blocks fusion"),
    ("Chlamydia pneumoniae", "CPn0585", "Rab4", "GEF"),
    ("Chlamydia pneumoniae", "CPn0809", "Golgi", "modulates"),

    # ── Ehrlichia chaffeensis (reroute)
    ("Ehrlichia chaffeensis", "TRP120", "Notch", "activates"),
    ("Ehrlichia chaffeensis", "TRP32", "Wnt", "activates"),
    ("Ehrlichia chaffeensis", "Ank200", "Host DNA", "modulates"),

    # ── Rickettsia conorii (escape)
    ("Rickettsia conorii", "RickA", "Arp2/3", "activates"),
    ("Rickettsia conorii", "Sca2", "Actin", "nucleates"),
    ("Rickettsia conorii", "Pat1", "Host membranes", "phospholipase"),

    # ── Salmonella typhi (modified_compartment)
    ("Salmonella typhi", "SopE", "Cdc42", "GEF"),
    ("Salmonella typhi", "SifA", "SKIP", "binds"),
    ("Salmonella typhi", "SseF", "Microtubules", "recruits"),

    # ── Escherichia coli K1 (arrest)
    ("Escherichia coli K1", "IbeA", "Vimentin", "binds"),
    ("Escherichia coli K1", "OmpA", "GPI anchor", "binds"),
    ("Escherichia coli K1", "CNF1", "RhoA", "deamidase"),

    # ── Neisseria gonorrhoeae (extracellular)
    ("Neisseria gonorrhoeae", "PorB", "Mitochondria", "anti-apoptotic"),
    ("Neisseria gonorrhoeae", "Opa", "CEACAM", "binds"),

    # ── Neisseria meningitidis (extracellular)
    ("Neisseria meningitidis", "PorB", "Mitochondria", "anti-apoptotic"),
    ("Neisseria meningitidis", "Opca", "CEACAM", "binds"),

    # ── Haemophilus influenzae (extracellular)
    ("Haemophilus influenzae", "Hap", "Extracellular matrix", "protease"),
    ("Haemophilus influenzae", "P5", "ICAM-1", "binds"),

    # ── Campylobacter jejuni (modified_compartment)
    ("Campylobacter jejuni", "Cdt", "Host DNA", "DNase"),
    ("Campylobacter jejuni", "FlaA", "TLR5", "activates"),

    # ── Orientia tsutsugamushi (escape)
    ("Orientia tsutsugamushi", "HlyA", "Host membranes", "pore-forming"),
    ("Orientia tsutsugamushi", "Pld", "Host membranes", "phospholipase"),

    # ── Bacillus cereus (escape)
    ("Bacillus cereus", "Hbl", "Host membranes", "pore-forming"),
    ("Bacillus cereus", "PC-PLC", "Host membranes", "phospholipase"),

    # ── Enterococcus faecalis (extracellular)
    ("Enterococcus faecalis", "Cyl", "Host membranes", "pore-forming"),
    ("Enterococcus faecalis", "Ace", "Collagen", "binds"),

    # ── Corynebacterium diphtheriae (extracellular)
    ("Corynebacterium diphtheriae", "DT", "EF-2", "ADP-ribosylates"),

    # ── Nocardia asteroides (arrest)
    ("Nocardia asteroides", "PLA", "Host membranes", "phospholipase"),
    ("Nocardia asteroides", "Sod", "ROS", "scavenges"),

    # ── Rhodococcus equi (modified_compartment)
    ("Rhodococcus equi", "VapA", "Host membranes", "modulates"),

    # ── Tropheryma whipplei (arrest)
    ("Tropheryma whipplei", "TW1", "Host cells", "binds"),

    # ── Mycobacterium bovis (arrest)
    ("Mycobacterium bovis", "LAM", "Vps34", "inhibits"),
    ("Mycobacterium bovis", "ESAT-6", "Host membranes", "pore-forming"),

    # ── Mycobacterium avium (arrest)
    ("Mycobacterium avium", "LAM", "Vps34", "inhibits"),

    # ── Mycobacterium marinum (arrest)
    ("Mycobacterium marinum", "LAM", "Vps34", "inhibits"),
    ("Mycobacterium marinum", "ESAT-6", "Host membranes", "pore-forming"),

    # ── Streptomyces scabies (extracellular)
    ("Streptomyces scabies", "Nec1", "Host cells", "necrosis"),

    # ── Klebsiella pneumoniae (extracellular)
    ("Klebsiella pneumoniae", "CPS", "Host immune", "antiphagocytic"),
    ("Klebsiella pneumoniae", "LPS", "TLR4", "activates"),

    # ── Acinetobacter baumannii (extracellular)
    ("Acinetobacter baumannii", "OmpA", "Mitochondria", "targets"),
    ("Acinetobacter baumannii", "Plc", "Host membranes", "phospholipase"),

    # ── Burkholderia cenocepacia (modified_compartment)
    ("Burkholderia cenocepacia", "AidA", "Host membranes", "modulates"),

    # ── Bacteroides fragilis (extracellular)
    ("Bacteroides fragilis", "BFT", "E-cadherin", "cleaves"),

    # ── Treponema pallidum (extracellular)
    ("Treponema pallidum", "Tp0751", "Extracellular matrix", "protease"),

    # ── Borrelia burgdorferi (extracellular)
    ("Borrelia burgdorferi", "OspA", "TLR2", "activates"),
    ("Borrelia burgdorferi", "DbpA", "Extracellular matrix", "binds"),

    # ── Leptospira interrogans (extracellular)
    ("Leptospira interrogans", "LenA", "Factor H", "binds"),
    ("Leptospira interrogans", "Loa22", "Collagen", "binds"),
]


if __name__ == "__main__":
    generate_all()

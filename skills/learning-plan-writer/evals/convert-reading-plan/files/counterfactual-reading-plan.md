# Reading plan: counterfactual image models (Glocker group)

**Pace:** about 3–4 hours a week, for 9 weeks, plus an optional extension.

## The core equation

Every paper in this line computes a counterfactual with Pearl's three steps:

1. **Abduction:** infer the noise that explains the observed image.
2. **Action:** change the chosen parent attributes.
3. **Prediction:** run the model forward with the same noise and the changed parents.

Written as one equation:

```
x̃ = f( f⁻¹(x, pa), p̃a )
```

The papers differ mainly in how they build the mechanism f and an approximate inverse f⁻¹ for images. The models used are, in order, normalising flows, VAEs, hierarchical VAEs and diffusion models.

### Notation

| Symbol | Meaning |
|---|---|
| x, x̃ | image, counterfactual image |
| pa, pa_x | causal parents of the image (age, sex, disease, scanner, etc.) |
| p̃a | parents after the intervention |
| u, ε, z | exogenous noise or latent variables |
| do(a := c) | intervention setting attribute a to value c |
| q(z \| x) | encoder (approximate posterior) |
| p(x \| z) | decoder |
| ELBO | evidence lower bound (training objective for VAEs and diffusion models) |
| KL(q ‖ p) | Kullback–Leibler divergence between two distributions |

---

## Week 1: Motivation and probability

- [ ] Castro, Walker & Glocker (2020), "Causality matters in medical imaging", *Nature Communications* (full paper)
- [ ] [*Mathematics for Machine Learning*](https://mml-book.github.io), Ch. 6, §6.1–6.5
- [ ] **Check:** explain p(x, y) vs p(x | y) vs p(x); derive Bayes' theorem from the product rule

## Week 2: Causal models and counterfactuals

- [ ] Pearl, Glymour & Jewell, *Causal Inference in Statistics: A Primer*: Ch. 1, Ch. 3 (skim), and the Ch. 4 sections on defining and computing counterfactuals
  - Free alternative: Peters, Janzing & Schölkopf, *Elements of Causal Inference*, Ch. 3 and 6
- [ ] [De Sousa Ribeiro et al. (2023)](https://arxiv.org/abs/2306.15764), §2.1 only
- [ ] **Exercise:** X := U_X, Y := 2X + U_Y. Observe X = 1, Y = 3. Compute Y under do(X := 2).
  - Abduction: U_X = 1, U_Y = 1
  - Action: X := 2
  - Prediction: Y = 2·2 + 1 = 5
  - Compare with the interventional answer E[Y | do(X = 2)] = 4 (if U_Y has mean zero)

## Week 3: Normalising flows (exact abduction)

- [ ] [*Mathematics for Machine Learning*](https://mml-book.github.io), §6.7 (change of variables)
- [ ] [Papamakarios et al. (2021), "Normalizing Flows for Probabilistic Modeling and Inference"](https://arxiv.org/abs/1912.02762), §1–2 (skim the rest)
- [ ] **Exercise:** if x ~ N(0, 1) and y = 2x + 1, show p_y(y) = ½ · p_x((y − 1)/2), so y ~ N(1, 4)

## Week 4: Variational autoencoders (approximate abduction)

- [ ] [Doersch (2016), "Tutorial on Variational Autoencoders"](https://arxiv.org/abs/1606.05908), §1–2
- [ ] [De Sousa Ribeiro & Glocker, "Demystifying Variational Diffusion Models"](https://arxiv.org/abs/2401.06281), §2.1
- [ ] Optional: [Kingma & Welling (2019), "An Introduction to Variational Autoencoders"](https://arxiv.org/abs/1906.02691), Ch. 2
- [ ] **Exercise:** show log p(x) = ELBO + KL(q(z | x) ‖ p(z | x)), and explain why this makes the ELBO a lower bound

## Week 5: Deep Structural Causal Models

- [ ] [Pawlowski, Castro & Glocker (2020), "Deep Structural Causal Models for Tractable Counterfactual Inference"](https://arxiv.org/abs/2006.06485): the framework sections and the Morpho-MNIST experiment (skim the MRI experiment)
- [ ] **Check:** which mechanisms give exact abduction and which approximate, and why? What goes wrong when abduction is only approximate?

## Week 6: Hierarchical VAEs and evaluating counterfactuals

- [ ] ["Demystifying Variational Diffusion Models"](https://arxiv.org/abs/2401.06281), §2.2–2.5
- [ ] [Monteiro et al. (2023), "Measuring axiomatic soundness of counterfactual image models"](https://arxiv.org/abs/2303.01274)
- [ ] **Check:** write one-line definitions of composition, reversibility and effectiveness. Which two would a model satisfy if it ignored the intervention entirely?

## Week 7: High-fidelity image counterfactuals

- [ ] [De Sousa Ribeiro et al. (2023), "High Fidelity Image Counterfactuals with Probabilistic Causal Models"](https://arxiv.org/abs/2306.15764) (full paper)
  - Focus: how the HVAE is conditioned on the parents, abduction and prediction with it, counterfactual fine-tuning
- [ ] Pearl Primer, mediation section at the end of Ch. 4 (direct, indirect and total effects)
- [ ] [Xia et al. (2024), "Mitigating attribute amplification in counterfactual image generation"](https://arxiv.org/abs/2403.09422)
- [ ] Optional: try the demos linked from the [causal-gen repository](https://github.com/biomedia-mira/causal-gen)

## Week 8: Diffusion background

- [ ] ["Demystifying Variational Diffusion Models"](https://arxiv.org/abs/2401.06281), Ch. 3, §3.1–3.7 (stop before §3.8)
- [ ] [Song, Meng & Ermon (2021), "Denoising Diffusion Implicit Models"](https://arxiv.org/abs/2010.02502): the deterministic sampler and inversion (inversion is the abduction step for diffusion models)
- [ ] [Ho & Salimans (2022), "Classifier-Free Diffusion Guidance"](https://arxiv.org/abs/2207.12598)

## Week 9: Diffusion counterfactuals

- [ ] [Rasal et al. (2025), "Diffusion Counterfactual Generation with Semantic Abduction"](https://arxiv.org/abs/2506.07883)
  - Focus: the trade-off between preserving identity and following the causal model
- [ ] [Xia et al. (2026), "Factored Classifier-Free Guidance"](https://arxiv.org/abs/2506.14399) (earlier arXiv versions titled "Decoupled Classifier-Free Guidance for Counterfactual Diffusion Models")
  - Focus: how a single global guidance weight causes attribute amplification, and the per-group fix

## Optional extension: identifiability

This needs optimal transport and flow matching, which the weeks above don't cover.

- [ ] [Peyré & Cuturi, *Computational Optimal Transport*](https://arxiv.org/abs/1803.00567), Ch. 1–2
- [ ] [Lipman et al. (2023), "Flow Matching for Generative Modeling"](https://arxiv.org/abs/2210.02747)
- [ ] [De Sousa Ribeiro, Santhirasekaram & Glocker (2025), "Counterfactual Identifiability via Dynamic Optimal Transport"](https://proceedings.neurips.cc/paper_files/paper/2025/hash/d938b739ac250e22729cc26e6176f65e-Abstract-Conference.html) (NeurIPS 2025)

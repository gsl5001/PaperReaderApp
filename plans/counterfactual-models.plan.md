---
format: plan/v1
id: counterfactual-models-2026
title: Generative Counterfactual Models (Glocker group)
start: 2026-11-09
library:
  - group: Textbooks
    docs:
      - id: mml
        title: Deisenroth, Faisal & Ong, Mathematics for Machine Learning
        url: https://mml-book.github.io/book/mml-book.pdf
      - id: pearl-primer
        title: Pearl, Glymour & Jewell, Causal Inference in Statistics, A Primer
      - id: peters-elements
        title: Peters, Janzing & Schölkopf, Elements of Causal Inference
      - id: peyre-cuturi-ot
        title: Peyré & Cuturi, Computational Optimal Transport
        url: https://arxiv.org/pdf/1803.00567v4
  - group: Tutorials and reviews
    docs:
      - id: papamakarios-2021
        title: Papamakarios et al. (2021), Normalizing Flows for Probabilistic Modeling and Inference
        url: https://arxiv.org/pdf/1912.02762v2
      - id: doersch-2016
        title: Doersch (2016), Tutorial on Variational Autoencoders
        url: https://arxiv.org/pdf/1606.05908v3
      - id: kingma-welling-2019
        title: Kingma & Welling (2019), An Introduction to Variational Autoencoders
        url: https://arxiv.org/pdf/1906.02691v3
      - id: demystifying-vdm
        title: De Sousa Ribeiro & Glocker, Demystifying Variational Diffusion Models
        url: https://arxiv.org/pdf/2401.06281v2
  - group: Papers
    docs:
      - id: castro-2020
        title: Castro, Walker & Glocker (2020), Causality matters in medical imaging
        url: https://www.nature.com/articles/s41467-020-17478-w.pdf
      - id: pawlowski-2020
        title: Pawlowski, Castro & Glocker (2020), Deep Structural Causal Models for Tractable Counterfactual Inference
        url: https://arxiv.org/pdf/2006.06485v2
      - id: monteiro-2023
        title: Monteiro et al. (2023), Measuring axiomatic soundness of counterfactual image models
        url: https://arxiv.org/pdf/2303.01274v1
      - id: ribeiro-2023
        title: De Sousa Ribeiro et al. (2023), High Fidelity Image Counterfactuals with Probabilistic Causal Models
        url: https://arxiv.org/pdf/2306.15764v2
      - id: xia-2024
        title: Xia et al. (2024), Mitigating attribute amplification in counterfactual image generation
        url: https://arxiv.org/pdf/2403.09422v1
      - id: song-2021-ddim
        title: Song, Meng & Ermon (2021), Denoising Diffusion Implicit Models
        url: https://arxiv.org/pdf/2010.02502v4
      - id: ho-salimans-2022
        title: Ho & Salimans (2022), Classifier-Free Diffusion Guidance
        url: https://arxiv.org/pdf/2207.12598v1
      - id: rasal-2025
        title: Rasal et al. (2025), Diffusion Counterfactual Generation with Semantic Abduction
        url: https://arxiv.org/pdf/2506.07883v1
      - id: xia-2026
        title: Xia et al. (2026), Factored Classifier-Free Guidance
        url: https://arxiv.org/pdf/2506.14399v5
      - id: lipman-2023
        title: Lipman et al. (2023), Flow Matching for Generative Modeling
        url: https://arxiv.org/pdf/2210.02747v2
      - id: ribeiro-2025-ot
        title: De Sousa Ribeiro, Santhirasekaram & Glocker (2025), Counterfactual Identifiability via Dynamic Optimal Transport
---

## 1. Motivation and probability

### Focus
- [ ] Read: Causality matters in medical imaging, full paper (60) [castro-2020 p.1-9]
- [ ] Read: Ch. 6, §6.1–6.5, probability spaces to the Gaussian (90) [mml p.178-210]
- [ ] Do: explain p(x, y), p(x | y) and p(x) in your own words (20)

### Listen
- [ ] Listen: NotebookLM overview of causality in medical imaging (20) [optional]
  - [castro-2020 p.1-9]

### Questions
1. Castro et al. call predicting a disease from an image, when the disease causes how the image looks, what kind of task?
   - [ ] Causal, because the model predicts from cause to effect
   - [x] Anticausal, because the model predicts the cause from its effect
   - [ ] Causal, because the image is the model's input
   - [ ] Neither: causal direction only matters for interventions
   Answer: Disease → image, and the model goes image → disease, against the arrow, so it is anticausal. Segmentation, where the label is made from the image, is the usual causal example.
   Ref: castro-2020 p.2
   Concepts: causal direction, causal vs anticausal tasks
2. [hard] Why should unlabelled images help more for an anticausal task than for a causal one?
   - [ ] Unlabelled images reduce overfitting in any task, more so when labels are noisy
   - [x] When the label causes the image, p(image) is a mixture over labels, so it carries information about p(label | image)
   - [ ] When the image causes the label, p(image) and p(label | image) share parameters
   - [ ] Anticausal tasks have fewer labels, so any extra data helps more
   Answer: With Y → X, p(X) = Σ p(X | Y) p(Y) is built from the mechanism that p(Y | X) inverts. With X → Y, p(X) and p(Y | X) are independent mechanisms, so more unlabelled X says nothing about p(Y | X).
   Concepts: causal direction, independent mechanisms
3. A model trained at hospital A fails at hospital B, whose scanner gives sharper, higher-contrast images. Disease rates and patients are the same. Which shift is this?
   - [x] Acquisition shift
   - [ ] Prevalence shift
   - [ ] Annotation shift
   - [ ] Population shift
   Answer: The mechanism that produces the image (scanner, protocol) changed, not the patients or the diagnoses. Prevalence shift would be a different disease rate; population shift, different patient characteristics.
   Ref: castro-2020 p.5
   Concepts: dataset shift
4. Bayes' theorem is a direct rearrangement of which identity?
   - [x] The product rule written both ways: p(x, y) = p(x | y) p(y) = p(y | x) p(x)
   - [ ] The sum rule: p(x) = Σ_y p(x, y)
   - [ ] Independence: p(x, y) = p(x) p(y)
   - [ ] The law of total expectation
   Answer: Equate the two factorisations of the joint and divide by p(x). The sum rule only comes in when p(x) in the denominator is computed.
   Ref: mml p.189
   Concepts: joint and conditional probability, Bayes' theorem

## 2. Causal models and counterfactuals

### Focus
- [ ] Read: Pearl Primer Ch. 1 (60) [pearl-primer]
- [ ] Read: Pearl Primer Ch. 3, skim (40) [pearl-primer]
- [ ] Read: Pearl Primer Ch. 4, sections on defining and computing counterfactuals (50) [pearl-primer]
- [ ] Read: free alternative to the Primer, Elements of Causal Inference Ch. 3 and 6 (120) [peters-elements] [optional]
- [ ] Read: High Fidelity Image Counterfactuals, §2.1 only (15) [ribeiro-2023 p.2-2]
- [ ] Do: exercise. X := U_X, Y := 2X + U_Y. Observe X = 1, Y = 3. Compute Y under do(X := 2), then compare with E[Y | do(X = 2)] (20)

### Listen
- [ ] Listen: NotebookLM overview of structural causal models and counterfactual inference (20) [optional]
  - [ribeiro-2023 p.2-2]
  - [pawlowski-2020 p.2-5]

### Questions
1. X := U_X, Y := 2X + U_Y. You observe X = 1, Y = 3. What is Y under the counterfactual do(X := 2)?
   - [ ] 4
   - [x] 5
   - [ ] 6
   - [ ] 3
   Answer: Abduction gives U_Y = 3 − 2 = 1, so Y = 2·2 + 1 = 5. 4 is E[Y | do(X = 2)] with zero-mean noise: the interventional answer, which ignores this unit's U_Y.
   Concepts: abduction-action-prediction, counterfactual vs interventional
2. Why can't a counterfactual be read off the interventional distribution p(y | do(x)) alone?
   - [ ] p(y | do(x)) can only be estimated from randomised experiments
   - [x] It describes the population average; a counterfactual needs this unit's own noise, which needs the structural equations
   - [ ] Counterfactuals need the observational distribution, which do() discards
   - [ ] It can, as long as the causal graph has no confounders
   Answer: Counterfactuals are about one individual, so they hold its exogenous noise fixed. Different SCMs with the same p(y | do(x)) can disagree on counterfactuals.
   Concepts: ladder of causation, counterfactual vs interventional
3. [hard] U ~ Bernoulli(0.5) and X := U_X. Model A has Y := X XOR U; model B has Y := U. You observe X = 0, Y = 0. Under do(X := 1), what does each give?
   - [ ] A: 0, B: 0
   - [x] A: 1, B: 0
   - [ ] A: 1, B: 1
   - [ ] Both give Y ~ Bernoulli(0.5), since they agree on interventions
   Answer: Abduction gives U = 0 in both. A: 1 XOR 0 = 1; B: Y = U = 0. The models agree on every observational and interventional distribution, yet disagree on this counterfactual.
   Concepts: identifiability, counterfactual vs interventional
4. In the abduction step for an image counterfactual, why infer the noise from the observed image rather than sample it from its prior?
   - [ ] Sampling from the prior is too slow for images
   - [x] A prior sample is a different, random individual: an interventional sample, not this image's counterfactual
   - [ ] The prior over the noise is unknown in deep models
   - [ ] Inferring it reduces the variance of the generated image
   Answer: The counterfactual must keep everything about this individual that the intervention doesn't change, which means conditioning on the observed image and parents.
   Ref: ribeiro-2023 p.2
   Concepts: abduction-action-prediction

## 3. Normalising flows (exact abduction)

### Focus
- [ ] Read: §6.7, change of variables (40) [mml p.220-226]
- [ ] Read: Normalizing Flows review, §1–2 (75) [papamakarios-2021 p.1-9]
- [ ] Read: Normalizing Flows review, skim §3–7 (30) [papamakarios-2021 p.10-50]
- [ ] Do: exercise. If x ~ N(0, 1) and y = 2x + 1, show p_y(y) = ½ · p_x((y − 1)/2), so y ~ N(1, 4) (20)

### Listen
- [ ] Listen: NotebookLM overview of normalising flows (20) [optional]
  - [papamakarios-2021 p.1-9]

### Questions
1. If x ~ N(0, 1) and y = 2x + 1, what is the distribution of y?
   - [ ] N(1, 2)
   - [x] N(1, 4)
   - [ ] N(2, 1)
   - [ ] N(1, 1)
   Answer: The mean moves to 1 and the standard deviation doubles, so the variance is 4. In the change-of-variables formula this is the factor ½ = |dx/dy|.
   Ref: mml p.220
   Concepts: change of variables
2. In p_x(x) = p_u(f⁻¹(x)) · |det J_{f⁻¹}(x)|, what does the determinant term account for?
   - [ ] The normalising constant of the base distribution
   - [x] How much f⁻¹ locally stretches or squeezes volume, so total probability stays 1
   - [ ] The curvature of f, which is zero for linear flows
   - [ ] The difference in dimension between x and u
   Answer: Probability mass is conserved, so where the map changes volume the density must change to match. This is why flows need Jacobian determinants that are cheap to compute.
   Ref: papamakarios-2021 p.2
   Concepts: change of variables, flow construction
3. [hard] Why does a conditional normalising flow give exact abduction, and what is the main cost for images?
   - [ ] Exact because the decoder is deterministic; costly because it needs adversarial training
   - [x] Exact because u = f⁻¹(x, pa) is computed directly; costly because u must have as many dimensions as the image
   - [ ] Exact because the posterior is Gaussian; costly because the ELBO is loose
   - [ ] Exact only for discrete parents; costly because it needs Monte Carlo sampling
   Answer: Invertibility given the parents recovers the noise without approximation and reconstructs the image perfectly, but there is no compression and the architecture is constrained.
   Concepts: exact abduction, flow construction
4. You compose two invertible flows, f₂ ∘ f₁. What happens to the log-determinant of the Jacobian?
   - [x] It is the sum of the two log-determinants
   - [ ] It is the product of the two log-determinants
   - [ ] It has to be recomputed for the composed map from scratch
   - [ ] It is the larger of the two
   Answer: The Jacobian of a composition is the product of the Jacobians, so determinants multiply and log-determinants add. This keeps deep flows tractable.
   Ref: papamakarios-2021 p.3
   Concepts: flow construction

## 4. Variational autoencoders (approximate abduction)

### Focus
- [ ] Read: Doersch tutorial, §1–2 (75) [doersch-2016 p.1-13]
- [ ] Read: Demystifying Variational Diffusion Models, §2.1 (30) [demystifying-vdm p.8-10]
- [ ] Read: Kingma & Welling introduction, Ch. 2 (90) [kingma-welling-2019 p.18-39] [optional]
- [ ] Do: exercise. Show log p(x) = ELBO + KL(q(z | x) ‖ p(z | x)), and explain why this makes the ELBO a lower bound (30)

### Listen
- [ ] Listen: NotebookLM overview of variational autoencoders (20) [optional]
  - [doersch-2016 p.1-13]
  - [demystifying-vdm p.8-10]

### Questions
1. log p(x) = ELBO + KL(q(z | x) ‖ p(z | x)). Why is the ELBO a lower bound on log p(x)?
   - [ ] Because the reconstruction term is always negative
   - [x] Because the KL term is never negative
   - [ ] Because q(z | x) is Gaussian
   - [ ] Because the decoder is deterministic
   Answer: KL divergence is ≥ 0, and 0 only when q(z | x) equals the true posterior, so ELBO ≤ log p(x).
   Ref: kingma-welling-2019 p.19
   Concepts: ELBO, KL divergence
2. ELBO = E_q[log p(x | z)] − KL(q(z | x) ‖ p(z)). What happens if you weight the KL term more heavily?
   - [ ] Sharper reconstructions, with latents further from the prior
   - [x] Latents closer to the prior, at the cost of reconstruction detail
   - [ ] Nothing, because the KL term is constant during training
   - [ ] A tighter bound on log p(x)
   Answer: The KL term pulls each posterior towards the prior; weighted up, the encoder keeps less information about x, so reconstructions blur.
   Ref: demystifying-vdm p.8
   Concepts: ELBO
3. What problem does the reparameterisation trick solve?
   - [ ] The KL term has no closed form
   - [x] Gradients can't pass through sampling z ~ q(z | x); writing z = μ + σ·ε makes z a differentiable function of the encoder's outputs
   - [ ] The decoder can't be inverted
   - [ ] The posterior collapses onto the prior
   Answer: Moving the randomness into ε ~ N(0, I) lets backpropagation reach μ and σ.
   Ref: doersch-2016 p.9
   Concepts: reparameterisation
4. [hard] With a VAE-based counterfactual model, you apply a null intervention (keep the observed parents). What do you expect?
   - [ ] Exactly the original image, because nothing changed
   - [x] A close but imperfect reconstruction that loses fine detail, because abduction is approximate
   - [ ] A random new image with the same parents
   - [ ] An error, because null interventions are undefined
   Answer: The encoder only approximates the posterior and the decoder is stochastic, so the inferred latent doesn't pin down x. A normalising flow would return x exactly.
   Concepts: approximate abduction, ELBO

## 5. Deep Structural Causal Models

### Focus
- [ ] Read: Deep SCMs, introduction and framework (§1–2) (60) [pawlowski-2020 p.1-5]
- [ ] Read: Deep SCMs, Morpho-MNIST case study (§4) (30) [pawlowski-2020 p.6-7]
- [ ] Read: Deep SCMs, brain MRI case study, skim (§5) (15) [pawlowski-2020 p.8-9]

### Listen
- [ ] Listen: NotebookLM overview of deep structural causal models (20) [optional]
  - [pawlowski-2020 p.1-9]

### Questions
1. In Deep SCMs, which kind of mechanism gives exact abduction?
   - [x] Invertible explicit (normalising flows)
   - [ ] Amortised explicit (VAE-style, with an encoder)
   - [ ] Amortised implicit (GAN-style)
   - [ ] Any of them, given enough training data
   Answer: Flows are invertible, so the noise is recovered exactly. Amortised explicit mechanisms infer the high-level latent with a variational encoder, which is approximate; only the low-level noise given that latent is inverted exactly.
   Ref: pawlowski-2020 p.3
   Concepts: exact abduction, approximate abduction
2. What is the typical sign of approximate abduction in a counterfactual image?
   - [x] Details the intervention shouldn't touch also change
   - [ ] The intervened attribute doesn't change at all
   - [ ] The image comes out as noise
   - [ ] Training diverges
   Answer: The inferred noise doesn't fully explain the observation, so regenerating with new parents alters unrelated details. An intervened attribute that doesn't change is an effectiveness problem, a different issue.
   Concepts: approximate abduction
3. In the Morpho-MNIST case study, what is the causal graph?
   - [ ] intensity → thickness; both → image
   - [x] thickness → intensity; both → image
   - [ ] image → thickness and image → intensity
   - [ ] thickness and intensity independent; both → image
   Answer: Stroke thickness is defined to cause stroke brightness (intensity), and both are applied to the digit to make the image.
   Ref: pawlowski-2020 p.6
   Concepts: SCM specification
4. [hard] Why can counterfactuals be checked on Morpho-MNIST but not on real scans?
   - [ ] Its counterfactuals come from the same model, so they match by construction
   - [x] Thickness and intensity can be measured on any generated image, so you can check the intended values were produced
   - [ ] The dataset includes real counterfactual pairs
   - [ ] Its images are small enough for exact abduction
   Answer: The true counterfactual of a real image is never observed. In Morpho-MNIST the attributes are measurable with morphometric tools, which gives a ground-truth check on the intervention.
   Concepts: counterfactual evaluation

## 6. Hierarchical VAEs and evaluating counterfactuals

### Focus
- [ ] Read: Demystifying Variational Diffusion Models, §2.2–2.5 (75) [demystifying-vdm p.11-18]
- [ ] Read: Measuring axiomatic soundness of counterfactual image models (90) [monteiro-2023 p.1-10]

### Listen
- [ ] Listen: NotebookLM overview of hierarchical VAEs and axiomatic soundness (20) [optional]
  - [demystifying-vdm p.11-18]
  - [monteiro-2023 p.1-10]

### Questions
1. A model ignores every intervention and returns its input unchanged. Which axioms does it satisfy?
   - [x] Composition and reversibility, but not effectiveness
   - [ ] Effectiveness only
   - [ ] All three
   - [ ] None, because it never uses the parents
   Answer: Returning x keeps null interventions unchanged (composition) and undoing an intervention gives x back (reversibility), but the requested attribute never changes. This is why effectiveness has to be measured too.
   Ref: monteiro-2023 p.3
   Concepts: axiomatic soundness
2. How is effectiveness measured in practice?
   - [ ] Distance between the image and the result of a null intervention
   - [x] Predictors trained on real data check that the counterfactual has the intended attribute values
   - [ ] Distance after applying an intervention and then reversing it
   - [ ] FID between counterfactual and real images
   Answer: The first option measures composition and the third reversibility. Effectiveness needs pseudo-oracle predictors of the parents to check the change happened.
   Ref: monteiro-2023 p.4
   Concepts: axiomatic soundness, counterfactual evaluation
3. Why do hierarchical VAEs give sharper images than a VAE with one latent layer?
   - [ ] They use an adversarial loss
   - [x] Several latent layers, generated top-down from coarse to fine, hold both global structure and fine detail
   - [ ] They drop the KL term
   - [ ] Their decoders are deterministic
   Answer: A single latent layer has to compress everything into one code; a hierarchy spreads the information across scales.
   Ref: demystifying-vdm p.11
   Concepts: hierarchical latent variable models
4. [hard] With top-down inference, what does the approximate posterior for latent layer i condition on?
   - [ ] Only the image x
   - [x] The layers above it (z_{>i}) and bottom-up features of x
   - [ ] Only the layers above it (z_{>i})
   - [ ] The layers below it (z_{<i})
   Answer: q(z_i | z_{>i}, x) shares the top-down path with the prior p(z_i | z_{>i}), which makes the two easier to match, and adds bottom-up information from x.
   Ref: demystifying-vdm p.15
   Concepts: hierarchical latent variable models, approximate abduction

## 7. High-fidelity image counterfactuals

### Focus
- [ ] Read: High Fidelity Image Counterfactuals, full paper. Focus on how the HVAE is conditioned on the parents, abduction and prediction with it, and counterfactual fine-tuning (120) [ribeiro-2023 p.1-9]
- [ ] Read: Pearl Primer, mediation section at the end of Ch. 4 (direct, indirect and total effects) (40) [pearl-primer]
- [ ] Read: Mitigating attribute amplification in counterfactual image generation (45) [xia-2024 p.1-7]
- [ ] Do: try the demos linked from the causal-gen repository (45) <https://github.com/biomedia-mira/causal-gen> [optional]

### Listen
- [ ] Listen: NotebookLM overview of high-fidelity image counterfactuals and attribute amplification (20) [optional]
  - [ribeiro-2023 p.1-9]
  - [xia-2024 p.1-7]

### Questions
1. In De Sousa Ribeiro et al.'s HVAE counterfactual model, where do the parents enter?
   - [ ] Only the encoder
   - [x] The prior at each latent layer, and the decoder
   - [ ] Only the top latent layer
   - [ ] A separate classifier that steers sampling
   Answer: Conditioning the priors and the decoder on the parents lets prediction decode the abducted latents under the counterfactual parents.
   Ref: ribeiro-2023 p.3
   Concepts: conditional HVAE, abduction-action-prediction
2. What problem does counterfactual fine-tuning address?
   - [ ] Blurry reconstructions
   - [x] The model ignores the parent conditioning, because the latents already encode the attributes, so interventions do little
   - [ ] Slow sampling
   - [ ] Posterior collapse in the top layer
   Answer: Fine-tuning uses pretrained parent predictors and trains the model so its counterfactuals are predicted to have the counterfactual parent values, which improves effectiveness.
   Ref: ribeiro-2023 p.5
   Concepts: counterfactual fine-tuning, axiomatic soundness
3. The natural direct effect of X on Y through a mediator M changes X from 0 to 1 while holding M at what?
   - [ ] M's value under X = 1
   - [x] M's value under X = 0
   - [ ] M's population average
   - [ ] Zero
   Answer: Freezing M at what it would have been without the change isolates the path X → Y. Holding X at 0 and moving M to its X = 1 value gives the natural indirect effect instead.
   Concepts: mediation
4. [hard] In Xia et al.'s Soft-CFT, which attributes are fine-tuned towards soft labels?
   - [ ] The intervened attributes
   - [x] Attributes that weren't intervened on and aren't downstream of an intervened one
   - [ ] All attributes
   - [ ] None: soft labels are only used at test time
   Answer: Hard labels push every attribute towards an extreme, amplifying ones that weren't intervened on. Soft-CFT keeps hard labels for intervened attributes and uses the predictor's probabilities on the original image for the rest.
   Ref: xia-2024 p.4
   Concepts: attribute amplification, counterfactual fine-tuning

## 8. Diffusion background

### Focus
- [ ] Read: Demystifying Variational Diffusion Models, Ch. 3, §3.1–3.7 (stop before §3.8) (120) [demystifying-vdm p.19-39]
- [ ] Read: DDIM, §2–4, non-Markovian forward process and the deterministic sampler (50) [song-2021-ddim p.2-6]
- [ ] Read: DDIM, §5.4, reconstruction from latent space (inversion is the abduction step for diffusion models) (10) [song-2021-ddim p.9-9]
- [ ] Read: Classifier-Free Diffusion Guidance (45) [ho-salimans-2022 p.1-10]

### Listen
- [ ] Listen: NotebookLM overview of diffusion models, DDIM and classifier-free guidance (20) [optional]
  - [demystifying-vdm p.19-39]
  - [song-2021-ddim p.1-10]
  - [ho-salimans-2022 p.1-10]

### Questions
1. Why can x_t be sampled directly from x_0 in Gaussian diffusion?
   - [x] Each forward step is linear Gaussian, so q(x_t | x_0) is Gaussian in closed form
   - [ ] The reverse process is deterministic
   - [ ] The noise schedule is linear in t
   - [ ] x_t is independent of x_0
   Answer: Compositions of linear Gaussian steps are Gaussian, giving q(x_t | x_0) = N(α_t x_0, σ_t² I) without simulating the earlier steps.
   Ref: demystifying-vdm p.23
   Concepts: forward diffusion
2. [hard] Why does each term of the diffusion ELBO have a closed form?
   - [ ] Because the denoising network is linear
   - [x] Conditioned on x_0, the forward posterior q(x_{t−1} | x_t, x_0) is Gaussian, and so are the generative steps, so each term is a KL between Gaussians
   - [ ] Because the prior p(x_T) is uniform
   - [ ] Because the timesteps are independent of each other
   Answer: Both sides of each KL are Gaussian, and the KL between two Gaussians has a closed form.
   Ref: demystifying-vdm p.34
   Concepts: diffusion ELBO, KL divergence
3. Why is DDIM inversion only approximate abduction?
   - [ ] The sampler adds fresh noise at each step
   - [x] The underlying ODE is solved in finite steps, so running it backwards accumulates discretisation error
   - [ ] The encoder is variational
   - [ ] The noise latent has fewer dimensions than the image
   Answer: With no sampling noise, generation is deterministic, which is what makes inversion possible at all; the error comes from discretising the ODE.
   Ref: song-2021-ddim p.5
   Concepts: DDIM inversion, approximate abduction
4. Raising the classifier-free guidance weight w generally does what?
   - [x] Samples match the condition more closely and are less diverse
   - [ ] Samples are more diverse and match the condition less closely
   - [ ] Nothing at sampling time
   - [ ] It requires retraining the classifier
   Answer: ε̃ = (1 + w) ε(x_t, c) − w ε(x_t) extrapolates away from the unconditional prediction. There is no separate classifier.
   Ref: ho-salimans-2022 p.4
   Concepts: classifier-free guidance

## 9. Diffusion counterfactuals

### Focus
- [ ] Read: Diffusion Counterfactual Generation with Semantic Abduction. Focus on the trade-off between preserving identity and following the causal model (90) [rasal-2025 p.1-9]
- [ ] Read: Factored Classifier-Free Guidance (earlier arXiv versions titled "Decoupled Classifier-Free Guidance for Counterfactual Diffusion Models"). Focus on how a single global guidance weight causes attribute amplification, and the per-group fix (90) [xia-2026 p.1-10]

### Listen
- [ ] Listen: NotebookLM overview of diffusion counterfactuals (20) [optional]
  - [rasal-2025 p.1-9]
  - [xia-2026 p.1-10]

### Questions
1. In diffusion counterfactuals, keeping more of the observed image in the abducted noise tends to do what?
   - [x] Preserve identity better, but make large interventions harder to express
   - [ ] Make interventions more effective, but weaken identity
   - [ ] Improve both identity and effectiveness
   - [ ] Nothing, since the noise is resampled
   Answer: Identity and following the intervention pull against each other: the more the noise pins down the original, the less room the model has to change it.
   Ref: rasal-2025 p.2
   Concepts: identity preservation, abduction-action-prediction
2. What does Rasal et al.'s semantic mechanism add to spatial noise inversion?
   - [ ] A classifier that steers sampling towards the parents
   - [x] An abducted semantic representation of the image that the model conditions on, a second source of identity information
   - [ ] A discriminator for realism
   - [ ] A flow that makes abduction exact
   Answer: With identity carried by the semantic representation too, interventions can take effect while the subject stays recognisable.
   Ref: rasal-2025 p.4
   Concepts: semantic abduction, identity preservation
3. Why does one global classifier-free guidance weight cause attribute amplification in counterfactuals?
   - [x] It pushes towards all conditioned attributes at once, so attributes you didn't intervene on get exaggerated too
   - [ ] It weakens the intervened attribute
   - [ ] It removes the unconditional model
   - [ ] It changes the noise schedule
   Answer: Factored CFG splits the condition into attribute groups with their own weights, so intervened attributes can be guided strongly and the rest weakly.
   Ref: xia-2026 p.4
   Concepts: classifier-free guidance, attribute amplification
4. [hard] Which of these gives exact abduction?
   - [x] A conditional normalising flow
   - [ ] A VAE with an amortised encoder
   - [ ] A hierarchical VAE
   - [ ] A diffusion model with DDIM inversion
   Answer: Flows invert exactly. VAEs and HVAEs infer latents approximately with an encoder; DDIM inversion is approximate because of discretisation.
   Concepts: exact abduction, approximate abduction, DDIM inversion

## 10. Optional extension: identifiability

### Focus
- [ ] Read: Computational Optimal Transport, Ch. 1–2 (150) [peyre-cuturi-ot p.7-40] [optional]
- [ ] Read: Flow Matching for Generative Modeling (90) [lipman-2023 p.1-10] [optional]
- [ ] Read: Counterfactual Identifiability via Dynamic Optimal Transport (NeurIPS 2025) (90) [ribeiro-2025-ot] [optional]

### Listen
- [ ] Listen: NotebookLM overview of optimal transport and flow matching (20) [optional]
  - [peyre-cuturi-ot p.7-40]
  - [lipman-2023 p.1-10]

### Questions
1. Why can the Monge formulation of optimal transport have no solution?
   - [x] It needs a deterministic map, which can't split mass, e.g. one point mass onto two points
   - [ ] Its cost function isn't convex
   - [ ] It only works in one dimension
   - [ ] It needs both distributions to be Gaussian
   Answer: Kantorovich relaxes the map to a coupling, which can split mass; that makes the problem a linear program with a solution under mild conditions.
   Ref: peyre-cuturi-ot p.17
   Concepts: optimal transport
2. What makes conditional flow matching training simulation-free?
   - [ ] It uses a discriminator in place of the likelihood
   - [x] It regresses onto per-sample conditional vector fields of a chosen path, which needs only samples along the path, not ODE solves
   - [ ] It trains with a fixed, small number of ODE steps
   - [ ] It inverts the flow analytically
   Answer: The conditional objective has the same gradients as regressing onto the intractable marginal vector field.
   Ref: lipman-2023 p.4
   Concepts: flow matching
3. [hard] What is the identifiability problem for counterfactual image models?
   - [ ] They can't be trained without counterfactual examples
   - [x] Many SCMs fit the same observational and interventional data but give different counterfactuals, so the data can't single one out
   - [ ] The parents of an image can't be measured
   - [ ] The likelihood is intractable
   Answer: As in section 2's XOR example: without further assumptions on the mechanisms, a model's counterfactual is one of many consistent answers.
   Concepts: identifiability

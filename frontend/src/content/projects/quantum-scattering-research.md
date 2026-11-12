---
title: 'Quantum Scattering Simulation Research'
slug: 'quantum-scattering-research'
summary: "Undergraduate research at UW–Madison with Prof. Irena Knezevic: a 2D Schrödinger solver combining the split-operator method with a total-field/scattered-field source, used to generate training data for neural networks that recover a scatterer's shape from the wave it scatters. Also covers an FDTD comparison solver and a Wigner phase-space view."
priority: 20
tags:
  - 'Python'
  - 'NumPy'
  - 'PyTorch'
  - 'Numerical Methods'
  - 'Quantum Mechanics'
  - 'Research'
repo: ''
demo: ''
published: true
---

## Overview

I do undergraduate research in Prof. Irena Knezevic's group in Electrical and Computer Engineering at UW–Madison. The group works on quantum transport, and my part of it is simulating how quantum wave functions scatter off potentials, and what can be learned from the scattered wave.

The core of the work is a 2D time-dependent Schrödinger solver I wrote from scratch in Python. It uses the **split-operator method** (SOM) to step the wave function forward in time, and a **total-field/scattered-field** (TF/SF) source, a technique borrowed from electromagnetics, to inject a clean incident wave into the simulation. On top of that solver I built a data pipeline and trained convolutional neural networks to solve the **inverse scattering problem**: given only the scattered wave, predict the shape of the thing it scattered off.

I presented this work as a poster, _Neural Networks for the Inverse Scattering Problem in Quantum Mechanics_, at the ECE SPARK (Summer Program for Advanced Research & Knowledge) poster session in August 2026.

> **Interactive demo coming soon** (`wavepacket-2d`): a Gaussian wave packet hitting a scatterer in 2D, with real-space and k-space views side by side.

## Why This Problem

The wave function is the central quantity in quantum mechanics, and its time evolution is governed by the Schrödinger equation:

$$
i\hbar\frac{\partial\psi}{\partial t} = H\psi = \left[-\frac{\hbar^2}{2m}\nabla^2 + V(\mathbf{r})\right]\psi
$$

Except for a handful of textbook potentials, this has to be solved numerically, and in 2D that gets expensive quickly.

The forward problem asks how a known potential scatters a known wave. The inverse problem runs the other way: you observe the scattered wave and want to recover the potential that produced it. Inverse problems like this show up in practice, for example in estimating potential landscapes (and defects) inside semiconductor devices, and in reconstructing phase images in electron microscopy (4D-STEM).

Neural networks are a promising approach to inverse problems, but they need a lot of training data, and that data has to come from a forward solver. So the goal was a forward solver that is both **accurate** and **fast enough to generate large datasets** on limited hardware (my laptop and one desktop GPU).

## The Forward Solver: Split-Operator Method

The Hamiltonian splits into kinetic and potential parts, $H = T + V$. The exact one-step propagator $e^{-iH\,dt/\hbar}$ can't be applied directly, but by the Baker–Campbell–Hausdorff formula it can be approximated as a product of the two pieces:

$$
\begin{aligned}
\psi(t + dt) &= e^{-\frac{i}{\hbar}H\,dt}\,\psi \\
&= e^{-\frac{i}{\hbar}T\,dt}\, e^{-\frac{i}{\hbar}V\,dt}\,\psi + \mathcal{O}(dt^2)
\end{aligned}
$$

The trick is that each piece is easy to apply in the right basis:

- $V$ is diagonal in **real space**, so $U_V = e^{-iV\,dt/\hbar}$ is just a pointwise multiply.
- $T = -\frac{\hbar^2}{2m}\nabla^2$ is diagonal in **momentum (k) space**, because a Fourier transform turns $\nabla$ into $i\mathbf{k}$. There, $U_T = e^{-i\hbar|\mathbf{k}|^2 dt/2m}$ is also a pointwise multiply.

So one time step is:

$$
\psi' = \mathcal{F}^{-1}\!\left(U_T\, \mathcal{F}\!\left(U_V\, \psi\right)\right)
$$

Apply the potential, FFT to k-space, apply the kinetic term, inverse FFT back, repeat. Each step costs $\mathcal{O}(N \log N)$ for $N$ grid points, and since both factors are pure phases, the method is unconditionally stable and conserves the norm of $\psi$. (If you know the pseudo-spectral time-domain method from electromagnetics, SOM is essentially its quantum mechanical cousin.)

I currently use the simple first-order (Lie) splitting rather than symmetric Strang splitting.

### Boundary conditions from the transform

The FFT implicitly makes the simulation box periodic: a wave leaving the right edge comes back on the left. I found that swapping the transform changes the boundary condition:

| Transform             | Boundary condition             | Behavior at the wall              |
| --------------------- | ------------------------------ | --------------------------------- |
| Fourier (FFT)         | Periodic                       | Wraps around                      |
| Discrete sine (DST)   | Dirichlet ($\psi = 0$)         | Hard wall, reflection flips phase |
| Discrete cosine (DCT) | Neumann ($\partial_n\psi = 0$) | Soft wall, no phase flip          |

The difference is visible in the simulation: Dirichlet walls show a dark destructive-interference line along the edge, and Neumann walls don't. To stop waves from reflecting back into the region of interest at all, the solver also has an absorbing layer near the edges.

> **Interactive demo coming soon** (`boundary-conditions`): the same packet hitting the box wall under periodic, Dirichlet, and Neumann boundaries.

### The solver and GUI

The solver is built around composable setup components: wave function initializers (Gaussian packets, plane waves), emitters, potential shapes (disks, polygons, pixel grids, slits), and filters such as Gaussian smoothing of sharp potential edges. An interactive GUI shows the probability density, the real and imaginary parts, and the k-space view live, which made it much easier to catch bugs. For example, a second ring that appeared in k-space turned out to be an aliasing (Nyquist) problem. The GUI also reproduces textbook behavior like double-slit interference and quantum revivals in a box.

## Injecting the Wave: Total-Field/Scattered-Field

For scattering, you want a steady incident wave (for example a plane wave) hitting the scatterer, without the incident wave also filling the whole box and wrapping around the periodic boundaries. TF/SF solves this. It's a standard technique in FDTD electromagnetics, and I derived a version of it for the split-operator Schrödinger solver.

Split the total wave function into an incident part that travels freely (no potential) and a scattered part:

$$
\begin{aligned}
i\hbar\frac{\partial\psi_\text{tot}}{\partial t} &= (T + V)\,\psi_\text{tot} \\
i\hbar\frac{\partial\psi_\text{inc}}{\partial t} &= T\,\psi_\text{inc}
\end{aligned}
$$

Subtracting the two gives the equation for the scattered part, $\psi_\text{scat} = \psi_\text{tot} - \psi_\text{inc}$:

$$
i\hbar\frac{\partial\psi_\text{scat}}{\partial t} = (T + V)\,\psi_\text{scat} + V\psi_\text{inc}
$$

Then define the simulated field as $\psi = \psi_\text{scat} + \zeta\,\psi_\text{inc}$, where $\zeta$ is a smooth mask that is 1 inside the total-field region (around the scatterer) and 0 outside it. Requiring this field to obey the Schrödinger equation plus a source term $S$, and choosing the mask so that the potential lies entirely inside the total-field region, gives:

$$
\begin{aligned}
S &= \zeta\, T\psi_\text{inc} - T(\zeta\,\psi_\text{inc}) \\
&= \frac{\hbar^2}{2m}\left(\nabla^2\zeta + 2i\,\mathbf{k}\cdot\nabla\zeta\right)\psi_\text{inc}
\end{aligned}
$$

where the second line uses the product rule on $\nabla^2(\zeta\,\psi_\text{inc})$ and $\nabla\psi_\text{inc} = i\mathbf{k}\,\psi_\text{inc}$ for a plane wave.

So the full equation the solver integrates is:

$$
i\hbar\frac{\partial\psi}{\partial t} = H\psi + \frac{\hbar^2}{2m}\left(\nabla^2\zeta + 2i\,\mathbf{k}\cdot\nabla\zeta\right)\psi_\text{inc}
$$

The source term only lives where the mask changes ($\nabla\zeta \neq 0$), so the incident wave appears inside the total-field region and is invisible outside it. Outside, you see only the purely scattered wave, which is exactly the signal an inverse-problem model should learn from. The source is added each step by scaling it by $dt$ and adding it to $\psi$.

> **Interactive demo coming soon** (`tfsf`): a plane wave masked into a total-field region, then hitting a triangle or polygon scatterer, with the scattered field visible outside the box.

## Solving the Inverse Problem

With the forward solver in place, the pipeline is:

1. Generate random scatterer potentials.
2. Simulate the scattering with TF/SF in the split-operator solver.
3. Record the scattered wave along the four sides of a square around the scatterer: backscatter, forward scatter, and the two sides.
4. Train a CNN (PyTorch) to predict the scatterer from those four signals.

Sampling only a ring around the scatterer, rather than the whole field, is closer to what a real measurement could see, and it keeps the input small enough for a compact 1D CNN that treats the four sides as four channels.

I trained models on three kinds of scatterers, each harder than the last:

- **Disks.** My first model looked at a full image of the wave some time after the packet hit a disk, and predicted the disk's radius and potential height. A "hit" is detected when the packet's spread in k-space passes a threshold. I started with a custom 2D CNN and also tried ResNet-18, which did no better on this small problem. Training took about 20 minutes on my laptop and about 2 minutes on a desktop GPU.
- **Polygons.** Predict the radius (0.5–3.5 units), potential height (5–100 units), and number of sides (3–7) of a polygon. Results: **5.91%** mean error on radius, **16.57%** on potential height, and **95.2%** accuracy classifying the number of sides.
- **Pixel grids.** The scatterer is a 5×5 grid of high or low potential "pixels", and the model predicts all 25 at once. It gets **about 93.5%** of individual pixels right.

The architectures are deliberately small: a few blocks of 1D convolution, batch norm, ReLU, and pooling, then fully connected layers with dropout. The polygon model shares one body between two heads: a regression head (radius, height) and a classification head (sides).

Height is harder to predict than geometry, which makes sense: the shape of the shadow and diffraction pattern depends strongly on geometry, while a taller barrier mostly just reflects a bit more.

> **Interactive demo coming soon** (`inverse-problem`): pick or draw a pixel-grid scatterer, watch the scattered wave, and compare the model's prediction with the truth.

## Comparing Methods: FDTD

SOM isn't the only way to solve the Schrödinger equation, so I also implemented a finite-difference time-domain (FDTD) solver to compare against. It uses a centered-time, centered-space (CTCS) scheme following Aşkar and Çakmak's explicit integration method for collision problems:

$$
\begin{aligned}
\nabla^2\psi_{j,k}^n &\approx \frac{\psi_{j+1,k}^n + \psi_{j-1,k}^n + \psi_{j,k+1}^n + \psi_{j,k-1}^n - 4\psi_{j,k}^n}{\Delta s^2} \\
\psi^{n+1} &= \psi^{n-1} - \frac{2i\,\Delta t}{\hbar}\, H\psi^n
\end{aligned}
$$

The TF/SF source carries over unchanged. The only difference is that the central difference spans two time steps, so the source is scaled by $2\Delta t$ instead of $\Delta t$.

The two methods trade off differently:

| Property             | FDTD                             | SOM / PSTD                           |
| -------------------- | -------------------------------- | ------------------------------------ |
| Grid resolution      | 8–16 cells per wavelength        | 2–4 cells per wavelength             |
| Cost per step        | $\mathcal{O}(N)$                 | $\mathcal{O}(N \log N)$              |
| Time step            | Limited by a CFL-style condition | No stability limit                   |
| Hard-wall boundaries | Easy                             | Need the sine/cosine transform trick |
| Sharp potentials     | Handled well                     | Can ring (Gibbs effect)              |
| Parallelizing        | Easy (local stencil)             | Harder (large FFTs across nodes)     |
| Memory               | Two time levels of $\psi$        | One                                  |

Because SOM needs about 4× fewer points per dimension, a 2D simulation needs roughly 16× less memory, which is a big part of why it suits dataset generation.

One thing I learned the hard way: CTCS is second-order accurate like the classic leapfrog scheme, but it isn't unitary, so the norm of $\psi$ oscillates instead of staying exactly 1. The natural next step is the staggered leapfrog scheme (Visscher's method), which updates the real and imaginary parts half a step apart and conserves a norm exactly.

> **Interactive demo coming soon** (`som-vs-fdtd`): the same packet run through both solvers at the same resolution, showing numerical dispersion as the grid gets coarser.

## Phase Space: The Wigner Function

Most recently I added a phase-space panel to the GUI that shows the **Wigner function** $W(x, k)$, a quasi-probability distribution over position and momentum at the same time:

$$
W(x, k) = \frac{1}{\pi}\int_{-\infty}^{\infty} \psi(x+s)\,\psi^*(x-s)\,e^{-2iks}\,ds
$$

For each point $x$, it correlates pairs of points symmetric around it and Fourier transforms over their separation, which tells you which momenta are present _around_ $x$. Its marginals give the usual position and momentum probability densities, but it can go negative, which is a signature of quantum interference.

The simulation is 2D, so the full phase space is 4D. To get a 2D view of $(x, k_x)$, I trace out $y$ to form a reduced density matrix, rather than summing $\psi$ over $y$, which would let phases from different rows interfere unphysically:

$$
\rho(x, x') = \operatorname{Tr}_y |\psi\rangle\langle\psi| = \int \psi(x,y)\,\psi^*(x',y)\,dy
$$

Then $\psi(x+s)\,\psi^*(x-s)$ in the definition becomes $\rho(x+s, x-s)$. In NumPy that's a single matrix multiply, and with careful FFT shifting the whole view takes about 2 ms per frame on a 200×200 grid. A normalized Gaussian packet checks out: $W$ sums to 1 and peaks at exactly $1/\pi$, the analytic value.

In phase space, a packet hitting a barrier is easy to read: it starts as a blob at $(x_0, k_0)$, shears as faster components pull ahead (that's wave-packet spreading), and then splits into a transmitted part at $+k$ and a reflected part at $-k$, with alternating positive and negative interference fringes between them.

> **Interactive demo coming soon** (`wigner`): a 1D packet scattering off a barrier, shown in real space and in the Wigner phase-space view at the same time.

## Getting Started in the Group

Before the scattering work, my first weeks went into getting up to speed with the group's tools and with scientific computing in general:

- Learned Fortran and OpenACC (GPU offloading) to work with the group's existing Fortran device simulation code, including a dependency graph of its modules to find my way around it.
- Built CSV input and a terminal UI for that code to make generating data and plots easier.
- Fit material parameters (for example, a bowing curve against indium content) and plotted superlattice band diagrams.
- Tried symbolic regression (PySR) on thermal transport data, and wrote a 1D transfer-matrix solver for piecewise-constant barriers as a first scattering code.

## What's Next

- **A comparison of time propagators.** I'm doing a literature review of methods for the time-dependent Schrödinger equation (split operator, Crank–Nicolson, Chebyshev, short iterative Lanczos, FDTD), focused on scattering: how sources are injected, how absorbing boundaries behave under each method, and how transmission and reflection are measured. TF/SF in the split-operator method, from this project, is one piece of that.
- **Wigner transport.** The phase-space view doubles as a reference for a Wigner transport simulation in the group, which evolves the Wigner function directly. Running both on the same problem and comparing them should be a good correctness check.
- **More realistic inverse problems.** Training on data closer to what an experiment could actually measure, such as time series recorded along the edges rather than a single snapshot.
- **Solver upgrades:** a leapfrog FDTD with norm conservation, time-dependent potentials and electric fields, a near-to-far-field transform for angle-resolved cross sections, and GPU batching for faster dataset generation.

## Stack

- **Simulation:** Python, NumPy, SciPy (FFT, DST, DCT)
- **Machine learning:** PyTorch, CNNs and ResNet-18
- **Visualization:** an interactive Dear PyGui app and Matplotlib
- **Earlier work:** Fortran, OpenACC, PySR
- **Write-ups and slides:** Quarkdown and LaTeX

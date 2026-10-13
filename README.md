# Neural Simulators: project page

Static project page (GitHub Pages) for the simagent research project. The
question on the page: can a model stand in for a rigid-body physics engine?
The page has two tabs:

- **Design proposals**: one block per proposal. The first block is the
  scene-graph world model (one token per object, flow matching over the
  60-frame trajectory tensor, trained on PhysX rollouts), its Diffusion
  Forcing, JEPA and autoregressive variants, how counterfactuals are asked, and
  where the simulator is used. Four small animations run on the real PhysX
  rollout of one benchmark task.
- **Results**: one block per result. The first block is the toy world-model
  experiment (status line, empty results table, an injection point for later
  results). The benchmark results of the language-model campaigns stay on the
  internal experiment dashboard (SSH tunnel to ccvl38:8097).

One HTML file, vanilla JavaScript, no build step and no CDN besides the Google
Fonts stylesheet; the page works from `file://` and from GitHub Pages. Data
is embedded as scripts, so nothing is fetched at run time.

## View it locally

```bash
cd project-dashboard
python3 -m http.server 8000        # then open http://localhost:8000/
```

or open `index.html` directly in a browser. `#design` and `#results` in the
URL select a tab.

## How to add a proposal or a result

Every contribution is one self-contained block, so that contributors never
edit each other's lines:

1. Pick a slug: lowercase letters, digits, `_` or `-` (the first blocks are
   `world_model` and `toy_world_model`).
2. Put images under `static/images/<slug>/`, data under
   `static/data/<slug>.js` (a script that defines one global, for example
   `window.MY_SLUG_DATA = {...}`; never fetch), and any scripts under
   `static/js/<slug>/`.
3. Append one `<section>` block inside the tab's wrapper in `index.html`:
   `<div id="design">` for proposals, `<div id="results">` for results, after
   the last block (each wrapper ends with an "append the next ... block here"
   comment). Do not edit the head, the hero, the tabs, the footer or another
   block.
4. Load the block's own data and scripts with `defer` at the end of the block,
   as the template shows; they run after the page is parsed, in order, and
   `window.WM` (tabs, animation runner, canvas helpers from
   `static/js/project.js`) is available to them.
5. Run `python3 tools/check_page.py` before pushing: it checks tag balance,
   local links, unique ids and the block convention, and lists the block ids.

Copy-paste template for a proposal (for a result use
`class="section result"` and `id="result-<slug>"`):

```html
  <!-- ---------- proposal: <slug> ---------- -->
  <section class="section proposal" id="proposal-<slug>">
    <div class="container is-max-desktop">
      <h2 class="title is-3">Title of the proposal</h2>
      <p class="wm-lead">One or two sentences: what it is and which measurements it rests on.</p>

      <div class="wm-section" id="<slug>-first">
        <h3 class="title is-4">1. First heading</h3>
        <div class="content">
          <p>Two to four sentences, or at most three bullets.</p>
        </div>
        <figure class="wm-figure">
          <img src="./static/images/<slug>/figure.png" alt="What the figure shows" loading="lazy">
          <figcaption>Short caption.</figcaption>
        </figure>
      </div>

      <!-- a result block typically uses these instead of figures:
      <div class="wm-status">Status: ...</div>
      <div class="table-container"><table class="table is-striped is-fullwidth wm-table">...</table></div>
      -->

      <!-- optional: this block's own data and scripts, deferred, in this order -->
      <script defer src="./static/data/<slug>.js"></script>
      <script defer src="./static/js/<slug>/main.js"></script>
    </div>
  </section>
  <!-- ---------- end proposal: <slug> ---------- -->
```

Shared classes available to every block: `wm-section` (a numbered
sub-section), `wm-figure`, `wm-anim` with `wm-controls`, `wm-caption`,
`wm-live` and `wm-note` (animations), `wm-svg-scroll` (wide diagrams scroll
on phones), `wm-status` (amber status box), `wm-table` (results table),
`wm-accent-red` and `wm-accent-blue`. Animations should use
`WM.runner({root, button, advance, render, representative})`, which adds
play/pause, pauses hidden tabs and starts paused on the representative frame
when the viewer prefers reduced motion.

## Layout

```
index.html                       the page: hero, tabs, proposal blocks, result blocks, footer
static/css/project.css           page styles layered over the template (muted base, three accents)
static/css/{bulma,bulma-carousel,bulma-slider,fontawesome.all}.min.css, index.css
                                 Nerfies template files, copied unchanged
static/js/project.js             shared: tabs, play/pause runner (honours prefers-reduced-motion), canvas and side-view helpers
static/js/world_model/anim_pipeline.js   scene graph -> tokens -> transformer -> output -> loss (SVG)
static/js/world_model/anim_flow.js       flow-matching phases on the red ball's recorded path (canvas)
static/js/world_model/anim_step.js       variant D step loop, one recorded frame per tick (canvas)
static/js/world_model/anim_forcing.js    Diffusion Forcing strip, 60 squares (SVG)
static/js/{fontawesome.all,bulma-carousel,bulma-slider}.min.js, index.js
                                 Nerfies template files, copied unchanged (see below)
static/data/world_model.js       window.WM_SAMPLE, generated by tools/extract_sample.py
static/images/world_model/       the five explainer figures, PNG and SVG
static/images/favicon.svg        tab icon
tools/extract_sample.py          regenerates static/data/world_model.js from the simagent repository
tools/check_page.py              tag balance, local links, ids and the block convention
```

## Regenerate the world-model sample data

`static/data/world_model.js` holds the instruction, the launch, the per-frame
positions and velocities of the red ball (`o024`) and the blue ball (`o025`),
the barrier (`o027`) pose and size, the red ball radius and the contact events
of task `b2_room_01_ball_over_barrier_hit_blue`, read from

- `observations/benchmark_v2/b2_room_01_ball_over_barrier_hit_blue/{scene_manifest,task}.json`
- the PhysX witness rollout listed in
  `runs/benchmark_v2/isaac_qualification_flight_v4/summary.json`
  (`<case output>/reference_rollout.json`, 61 sampled states at 30 Hz)

in the simagent checkout. To regenerate (standard library only):

```bash
python3 tools/extract_sample.py                      # simagent root = parent of this repo, or $SIMAGENT_ROOT
python3 tools/extract_sample.py --simagent-root /path/to/simagent --output static/data/world_model.js
```

Floats are rounded to 4 decimals; the script fails instead of guessing when an
input is missing or has an unexpected shape.

## Figures

`static/images/world_model/world_model_{overview,a_inputs_outputs,b_training,c_simulator_use,d_step_predictor}.{png,svg}`
are copied from `reports/world_model/figures/` in the simagent repository.
They are drawn by `scripts/draw_world_model_figure.py` there, from the sample
task's real manifest and PhysX rollout; `figure_receipt.json` next to the
originals records the inputs. The text of the design lives in
`docs/WORLD_MODEL_DESIGN.md` in the same repository; the page is a compact
rendering of it, not a replacement.

## Checks

```bash
python3 tools/check_page.py      # tag balance, local src/href targets, unique ids, block convention, data file starts with window.WM_SAMPLE
```

To look at a particular moment of the animations, open the page with
`?t=<seconds>` (for example `index.html?t=12`): every animation is advanced by
that many seconds and starts paused, so screenshots are reproducible.

## Updating the toy world-model result

- Replace `JOB_ID_PLACEHOLDER` in the status box (`#toy-status` inside
  `#result-toy_world_model`) with the Slurm job id.
- Fill the `pending` cells of `#toy-results-table`, or let a later script
  (for example `static/data/toy_world_model.js`, loaded with `defer` at the
  end of the block) inject rendered results into the empty
  `<div id="toy-results">` container (it is hidden while empty).

## Benchmark results block and page

`#result-benchmark_v31` opens the Results tab of `index.html`; the full page is
`benchmark.html`. Both show GPT-5.4 and Qwen3-VL-30B Thinking on the benchmark:
the results table (best cell green, weak cells red, rows where the models differ
by 30 points or more marked amber), the difficulty tiers, and examples as
horizontal grids so the reference and both models can be compared side by side.
Launch tasks show the three simulator clips (reference, GPT-5.4, Qwen) that
play together on hover or with the play button; static edits show the room
before the edit with the area of interest outlined, then close-ups of the
reference and both answers (hover a close-up to see it before the edit). The
four examples shown first (one static edit, a hard and a medium launch, a throw)
are listed in `FEATURED` at the top of the extractor; the other examples in
`EXAMPLES`.

Rendering is done by `static/js/benchmark/render.js` and
`static/js/benchmark/anim_pipeline.js` from `static/data/benchmark_results.js`
(`window.BM_RESULTS`). To regenerate, from the simagent checkout:

```bash
# close-ups of the static examples (Isaac, one GPU, about a minute)
sbatch --partition=main --gres=gpu:a5000:1 scripts/isaac_job.sbatch \
    project-dashboard/tools/render_closeups.py --tasks TASK_ID [TASK_ID ...]
# data and media (needs Pillow and imageio-ffmpeg: the simagent Isaac interpreter)
.envs/isaac/bin/python project-dashboard/tools/extract_benchmark_results.py
cd project-dashboard && python3 tools/check_page.py && python3 tools/check_page.py --page benchmark.html
```

`render_closeups.py` fits a camera on the open front side of the room to every
object the instruction involves (moved by the reference or either model, or named
by a check), before and after, and renders the four states posed exactly as
answered. The extractor copies the simulator clips at their native 640 x 480
without re-encoding, writes first-frame posters, and outlines the close-up area
on the overview render. Variants with reasoning switched off, feedback rounds
and the yes/no questions are deliberately not shown.

## How models are prompted (page)

`how-it-works.html`, linked as a tab from the landing page, shows on real
records what GPT-5.4 and Qwen3-VL-30B Thinking receive and return: an icon
overview of one attempt (`static/js/how_it_works/overview.js`), the real prompt
drawn to scale and filled in part by part with its actual text and images
(`prompt.js`), and three columns (reference, GPT-5.4, Qwen) where the real
answers type out (JSON poses, a program excerpt with its real line numbers, or
the launch as numbers), the simulator plays them (floor plan, or the ball's
recorded side-view path) and the measured checks decide (`answer.js`). Data:
`static/data/how_it_works.js` (`window.HW_DATA`) and the input views under
`static/images/how_it_works/`, written by `tools/extract_how_it_works.py` (run
with the simagent Isaac interpreter; the program excerpts are the line ranges
in `CODE_EXCERPTS`).

## Template and license

The page layout is adapted from the [Nerfies](https://nerfies.github.io)
project page template, which is licensed under a Creative Commons
Attribution-ShareAlike 4.0 International License and asks for the attribution
kept in the footer. The template's CSS and JS files are copied unchanged into
`static/css` and `static/js`; the page loads `bulma.min.css`, `index.css` and
`fontawesome.all.min.js`. `bulma-carousel`, `bulma-slider`,
`fontawesome.all.min.css` (it expects web fonts the template did not ship) and
the template's `index.js` (it needs jQuery, which is not shipped) are kept
for completeness but not loaded. The template's Google Analytics snippet was
removed. The repository's own code is under the MIT license in `LICENSE`.

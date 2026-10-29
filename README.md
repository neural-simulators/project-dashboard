# Neural Simulators: project page

Static project page (GitHub Pages) for the simagent research project. The
landing page is `index.html` with four in-page tabs; the other tabs are
standalone pages that share the same navigation:

- **Overview** (`#overview`, the default): what the project is about, an
  animated map of how its parts connect (`static/js/overview/map.js`; each box
  links to its tab), one card per part with its status, and the visitor
  map at the bottom.
- **World model** (`#design`): one block per proposal, starting with the
  scene-graph world model.
- **Post-training** (`#post-training`): the post-training proposal, installed
  from `post_training.html` (see "Post-training blocks" below).
- **Results** (`#results`): one block per result (benchmark, toy world model,
  post-training).
- Standalone pages: `how-it-works.html`, `benchmark.html` (the full benchmark
  results, under the Results tab), `end-to-end.html`, `scaled-results.html` and
  `improved-results-v*.html` (co-author pages), `digital-twins.html`.

The Overview is motivation only: why learn the simulator, and what each part of
the project is for, without results, numbers or plans. Proposals and ideas live
on the model tabs (World model, Post-training), with ids and equations; results
pages keep results and point to the ideas by id.

Every tab and page opens with a short intro box (`<div class="wm-intro">`: a
question as its title, the idea and why it matters in plain words, optionally a
row of `wm-facts` numbers), then the details. Keep intros about the idea, not
about the page's own layout (no "this page has N sections" lines).

## Visitor map

The Overview tab ends with a MapMyVisitors world map (`#overview-visitors`), the owner's account, loaded with `async` (the
script finds its own `<script id="mapmyvisitors">` tag and inserts the map after it). Its statistics page shows visits
over chosen time ranges. The earlier hits.sh counter was removed because ad blockers block it.

One HTML file per page, vanilla JavaScript, no build step and no CDN besides the
Google Fonts stylesheet (KaTeX is vendored under `static/vendor/`); the only
third-party script is the visitor map. Pages work from `file://` and from GitHub
Pages. Data is embedded as scripts, so nothing is fetched at run time.

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
static/js/world_model/anim_bidirectional.js   one masked model, four questions on a toy crate scene (forward; backward from
                                 the whole motion; infer from 0.9 s and continue; backwards in time from the last 0.3 s);
                                 regression / flow matching / diffusion; exact grid posterior of the toy, computed in the
                                 browser when the World model tab is first shown (canvas)
static/js/{fontawesome.all,bulma-carousel,bulma-slider}.min.js, index.js
                                 Nerfies template files, copied unchanged (see below)
static/data/world_model.js       window.WM_SAMPLE, generated by tools/extract_sample.py
static/images/world_model/       the five explainer figures, PNG and SVG; web_*.svg drawn by tools/draw_web_figures.py (section 5, 6,
                                 10, 14 and the four capability figures of section 18: data, model as it is, questions, what to build)
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

## Digital twins page

`digital-twins.html` is linked from the landing page's **Digital twins** button.
It explains the actual counter reconstruction with source views, SAM2 input
masks, rotating SAM3D meshes, collision hulls, physical assumptions and three
saved PhysX videos. Automatic scene discovery, world-model transfer to captured
graphs and Gaussian motion rendering are labeled as proposed. The page contains
method details and no campaign, scheduler or debugging records.

The page uses `static/css/digital_twin.css` and
`static/js/digital_twin/main.js`, together with the shared `WM.runner`.
Videos show their first frames as posters. Hover starts the synchronized group;
click pins playback, and the toolbar pauses the group or selects quarter speed.
The animations honor reduced motion and the existing `?t=<seconds>` preview
parameter. Wide diagrams scroll inside their panels on phones.

Rebuild the assets from the parent simagent checkout into a fresh staging root:

```bash
../.envs/reconstruction/bin/python tools/extract_digital_twin.py \
  --output ../reports/digital_twin_site_assets_NEW \
  --jar-run ../runs/counter_gator_v1/supported/jar_drop_dashboard_v1 --install
python3 tools/check_page.py --page digital-twins.html
python3 tools/check_page.py
```

The extractor saves actual input crops, reduced display meshes, calibrated
camera/context geometry and H.264 clips, with source hashes in the staging
directory. The generated images, video and `static/data/digital_twin.js` are
ignored; include those installed assets when packaging the static site. Audit
receipts with local source paths stay outside the served page.

For browser checks, use an environment containing Python Playwright and its
Chromium browser:

```bash
PLAYWRIGHT_BROWSERS_PATH=../.cache/dashboard_browser \
  ../.envs/dashboard_browser/bin/python tools/check_digital_twin.py \
  --output ../reports/digital_twin_browser_NEW
```

This checks desktop and mobile rendering, source images, reduced motion,
hover/touch playback, click-to-pin/pause, slow motion and synchronized loops.

## How models are prompted (page)

`how-it-works.html` follows one real attempt step by step, at the reader's pace (Back / Next, the step list or the arrow
keys; nothing advances on its own), for three examples (a static edit, a throw answered with numbers, the same throw
answered with a program) and either model: the task and the two images the models receive, the full prompt split into
its sections (the scene also as a table, and its exact one-line JSON), the answer format (the strict JSON schema sent
with the request, or the program contract), each model's raw reply and token use, the harness steps from the reply to
the simulation with the actual values (contract, quaternion rescaling, carry-forward, the derived launch), every check
with its measured value and limit, and the outcome (close-ups or the three PhysX rollout clips). Script
`static/js/how_it_works/walkthrough.js`; data `static/data/how_it_works.js` (`window.HW_DATA`), task views under
`static/images/how_it_works/` and rollout clips under `static/media/how_it_works/`, all written by
`tools/extract_how_it_works.py` (run with the simagent Isaac interpreter; the static close-ups are reused from the
benchmark page and must exist).

## Formal sections (math)

The World model and Post-training tabs carry formal definitions (`#world_model-symbols`, `#post_training-symbols`,
`#post_training-wm-judge`), the comparison with other approaches (`#world_model-compare`, moved from the scaled
results page) and the world-model to-do list: groups A to C in `#world_model-todo` (ghost motion, kinematics, shape and
identity), D and E in `#world_model-language-uncertainty`, F (collisions) in `#world_model-collisions`, G (backward
questions, with the schematic `web_bidirectional.svg` drawn by `tools/draw_web_figures.py` and the animation
`#anim-bidirectional`) in `#world_model-backward`, H and I (training data, speed, real scenes) in `#world_model-data-real`. Each
item is `<li id="WM-F3" data-todo="WM-F3">` with a state badge (`wm-badge-todo`, `-first`, `-done`, `-run`, `-wait`)
and, once something was built, a `wm-todo-note` linking to its results. A link to any element inside a tab, such as
`index.html#WM-F3`, opens that tab and scrolls to it (`static/js/project.js`). Math is written as LaTeX, `\( ... \)` inline and `\[ ... \]` displayed, inside any element with
class `wm-math`, and typeset in the browser by `static/js/math.js` with KaTeX 0.16.11 vendored under
`static/vendor/katex/` (MIT licence there; no CDN). Without JavaScript the LaTeX stays readable.

## Navigation shared by all pages

The project's tabs are listed once, in `static/js/site_nav.js`: Overview, World
model, Post-training, How models are prompted, Results, End-to-end study,
Scaled results, Improved Results V1 and V2, Digital twins. Every standalone page (`end-to-end.html`,
`scaled-results.html`, `how-it-works.html`, `digital-twins.html`,
`benchmark.html`) carries an empty
`<nav class="tabs is-centered is-boxed wm-tabs" data-site-nav="KEY">` under its
hero and loads the script, which fills in the tabs and marks KEY as the current
page. `index.html` keeps a static tab bar (its in-page tabs need `data-tab`
attributes) with the same entries in the same order.

Pages generated elsewhere (the end-to-end and scaled-results pages) must emit
that `<nav data-site-nav="end-to-end">` (or `"scaled-results"`) element, load
`./static/js/site_nav.js`, and keep their intro box, instead of a hand-written
tab bar; otherwise a rebuild brings back a stale tab list.
`tools/check_nav.py` fails when they do not.

Those generators copy the `<head>` of `end-to-end.html`, so a script added there
reaches every regenerated page. `static/js/clip_groups.js` uses this: on the
results pages it folds each comparison gallery (a `.gallery` with its own
`grid-template-columns`) into closed groups by kind of scene, folds theme
galleries under their `p.dhead` heading, and plays a clip while the pointer is
over it or its open group (styles under "Clip groups" in `project.css`).

To add a tab or page: add one line to the list in `site_nav.js`, mirror it in
`index.html`'s tab bar, give a new page the `<nav data-site-nav>` element and the
script, and run `python3 tools/check_nav.py`, which fails when any page shows a
different set of tabs.

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

## Post-training blocks (`proposal-post_training`, `result-post_training_poc`)

The proposal block fills the Post-training tab (`<div id="post-training">`,
anchor comment "install the post-training block here"); the result block sits
in the Results tab. Three step-by-step animations run on real benchmark
records, each a canvas beside an HTML side panel that carries the explanation
at page font size:

- **Training examples**: two static edits (room 1 chair approach, room 8 book
  between the cups) and three launches (room 6 floor-then-wall rebound, easy;
  room 2 ball hits ball before a deadline, medium; room 2 lob into the box,
  hard). For each: the task, then the reference answer and three models'
  answers judged one by one (plan and front views for static edits with heights
  to scale; side view of the real PhysX rollouts for launches, plus a
  position-over-time chart for balls that roll), then the training reward of
  every answer.
- **GRPO**: the untrained 7B model's 16 real answers for room 1 (scores,
  advantages, the update, and what one group cannot teach) and thirteen
  launches PhysX judged for the room 2 lob (reference, three models, nine
  random launches) in launch-velocity space.
- **DPO**: the 7B model's own better and worse answer for room 8, and a launch
  pair for the room 2 lob, with the DPO loss.

Canvases are drawn in CSS pixels (text 13 to 19 px) and every view is zoomed to
the objects that matter; below 480 px of canvas width the labels switch to
short forms. The page shows no job ids, machines or paths; the data file keeps
them for provenance only.

```
post_training.html                          standalone preview; the source of the two blocks (marker comments)
static/js/post_training/main.js             the three widgets (WM.runner), the experiment table and the result block
static/css/post_training.css                block styles, injected by main.js (index.html's head stays untouched)
static/data/post_training.js                window.POST_TRAINING_DATA, generated by tools/extract_post_training_sample.py
tools/extract_post_training_sample.py       reads manifests, private specs, qualification, campaign and job records from the simagent checkout
tools/install_post_training_block.py        copies the two blocks from post_training.html into index.html (idempotent), then runs check_page.py
tools/check_post_training.py                checks the standalone page, its data file and the script's bracket balance
```

Browsers cache scripts: Python's `http.server` sends no cache headers, and a
normal reload does not re-check scripts the browser considers fresh, so an
edited shared script can keep running in its old form (on 2026-10-13 an old
`project.js` sent the new Post-training tab back to World model). Every local
stylesheet and script link on every page therefore carries `?v=<content hash>`:
run `python3 tools/stamp_assets.py` after editing anything under `static/`
(`--check` lists stale links; the post-training installer runs it too). `project.js` also reads the tab names from the
`data-tab-panel` panels on the page, so a new tab needs no edit there.

To refresh: `python3 tools/extract_post_training_sample.py` (it imports the
simagent reward to score the static answers; edit `JOB`, `POC` and the example
lists at the top when the inputs change), then
`python3 tools/install_post_training_block.py`. Design text:
`docs/RL_POST_TRAINING.md` in the simagent repository.

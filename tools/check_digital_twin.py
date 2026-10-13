#!/usr/bin/env python3
"""Check the digital-twin page and its video interactions in software Chromium."""
import argparse
import json
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='Fresh directory for browser evidence')
    parser.add_argument('--url', help='Optional served page URL; defaults to the local HTML file')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[1]
    subprocess.run([sys.executable, str(root / 'tools/check_page.py'), '--page', 'digital-twins.html'], check=True)
    subprocess.run([sys.executable, str(root / 'tools/check_page.py')], check=True)
    from playwright.sync_api import sync_playwright
    errors = []
    checks = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--disable-gpu', '--no-sandbox'])
        for mobile in [False, True]:
            context = browser.new_context(viewport={'width': 390 if mobile else 1440, 'height': 844 if mobile else 1000},
                                          reduced_motion='reduce' if mobile else 'no-preference', has_touch=mobile)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto((args.url or (root / 'digital-twins.html').as_uri()) + '?t=8', wait_until='load')
            assert page.locator('video').count() == 3
            assert page.locator('.dt-view').count() == 7
            assert page.locator('.dt-mask-card').count() == 3
            assert page.locator('.dt-mesh-card').count() == 3
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            for section in page.locator('.dt-section').all():
                section.scroll_into_view_if_needed()
                page.wait_for_timeout(60)
            assert page.locator('img').evaluate_all('(images) => images.every(i => i.complete && i.naturalWidth > 0)')
            body = page.inner_text('body')
            assert all(word not in body for word in ['Slurm', '/datasets/', 'runs/', 'MaxSubmitJobs', 'A5000'])
            assert 'VISUAL TRANSFER NOT YET TESTED' in body
            if mobile:
                assert page.locator('.wm-anim .wm-controls button').evaluate_all('(buttons) => buttons.every(b => b.getAttribute("aria-pressed") === "false")')
            page.locator('#dt-video-gallery').scroll_into_view_if_needed()
            page.wait_for_timeout(250)
            assert page.locator('video').evaluate_all('(videos) => videos.every(v => v.paused && v.currentTime === 0 && v.poster)')
            if mobile:
                page.locator('video').first.tap()
            else:
                page.locator('video').first.hover()
            page.wait_for_timeout(950)
            states = page.locator('video').evaluate_all('(videos) => videos.map(v => ({time: v.currentTime, paused: v.paused, duration: v.duration}))')
            assert all(not s['paused'] and s['time'] > .1 for s in states), states
            assert max(s['time'] for s in states) - min(s['time'] for s in states) < .18, states
            if not mobile:
                page.locator('video').first.click()
                page.mouse.move(1, 1)
                page.wait_for_timeout(300)
                assert page.locator('video').evaluate_all('(videos) => videos.every(v => !v.paused)')
            page.locator('#dt-video-speed').click()
            assert page.locator('video').evaluate_all('(videos) => videos.every(v => v.playbackRate === .25)')
            page.locator('#dt-video-toggle').click()
            assert page.locator('video').evaluate_all('(videos) => videos.every(v => v.paused && v.currentTime === 0)')
            page.locator('#dt-video-toggle').click()
            page.wait_for_timeout(250)
            page.locator('video').evaluate_all('(videos) => videos.forEach(v => v.currentTime = v.duration - .04)')
            page.wait_for_timeout(700)
            assert page.locator('video').evaluate_all('(videos) => videos.every(v => !v.paused && v.currentTime < 1)')
            page.locator('#dt-video-toggle').click()
            page.locator('#dt-objects').scroll_into_view_if_needed()
            page.locator('#dt-show-colliders').check()
            assert page.locator('#dt-show-colliders').is_checked()
            page.locator('.dt-view').first.click()
            assert page.locator('.dt-view').first.get_attribute('aria-pressed') == 'true'
            page.evaluate('scrollTo(0, 0)')
            name = 'mobile' if mobile else 'desktop'
            page.screenshot(path=str(args.output / f'{name}.png'), full_page=True)
            checks.append({'viewport': name, 'video_states_during_playback': states,
                           'no_horizontal_overflow': True, 'images_loaded': True, 'synchronized_playback': True,
                           'hover_or_touch': True, 'click_pin_pause': True, 'slow_motion': True,
                           'synchronized_loop': True, 'reduced_motion_checked': mobile})
            context.close()
        browser.close()
    if errors:
        raise RuntimeError(f'Browser errors: {errors}')
    (args.output / 'browser_checks.json').write_text(json.dumps({'checks': checks, 'page_errors': errors}, indent=2) + '\n')
    print(json.dumps({'event': 'digital_twin_browser_checks', 'viewports': len(checks), 'errors': len(errors)}), flush=True)


if __name__ == '__main__':
    main()

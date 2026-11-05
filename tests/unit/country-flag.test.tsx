// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {render,screen} from '@testing-library/react';
import {CountryFlag} from '../../src/renderer/CountryFlag';

it('renders a bundled flag with a localized accessible country name',()=>{
 render(<CountryFlag countryCode="US" language="en"/>);
 const flag=screen.getByRole('img',{name:'United States'});
 expect(flag.getAttribute('src')).toMatch(/svg/);
 expect(flag.getAttribute('src')).not.toMatch(/^https?:/);
});

it('renders no flag for unknown or invalid country codes',()=>{
 const {container,rerender}=render(<CountryFlag countryCode={null} language="en"/>);
 expect(container.querySelector('img')).toBeNull();
 rerender(<CountryFlag countryCode="../../secret" language="en"/>);
 expect(container.querySelector('img')).toBeNull();
});

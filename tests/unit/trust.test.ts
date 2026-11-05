import {it,expect} from 'vitest';
import {isTrustedSender} from '../../src/main/trust';
const ui='file:///C:/Program%20Files/Local%20Profiles/%D0%BF%D1%80%D0%B8%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5/index.html';
function fixture(){const mainFrame={url:ui,parent:null};const contents={id:1,mainFrame};return {mainFrame,contents};}
it('accepts only the exact main frame of the trusted window',()=>{
  const {mainFrame,contents}=fixture();
  expect(isTrustedSender({sender:contents,senderFrame:mainFrame},contents,ui)).toBe(true);
  expect(isTrustedSender({sender:{id:2},senderFrame:mainFrame},contents,ui)).toBe(false);
  expect(isTrustedSender({sender:contents,senderFrame:Object.assign({url:ui},{parent:mainFrame}) as {url:string}},contents,ui)).toBe(false);
  expect(isTrustedSender({sender:contents,senderFrame:{url:'https://example.com'}},contents,ui)).toBe(false);
  expect(isTrustedSender({sender:contents,senderFrame:null},contents,ui)).toBe(false);
  expect(isTrustedSender({sender:contents,senderFrame:mainFrame},contents,ui.replace('%20',' '))).toBe(false);
});


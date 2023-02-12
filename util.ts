import axios from 'axios';
import { JSDOM } from 'jsdom';

export async function parseXmlFromUrl(url: string): Promise<Document> {
  return axios.get(url)
    .then(response => response.data)
    .then(text => {
      return new JSDOM(text, { contentType: "text/xml" }).window.document;
    })
    .catch(err => {
      console.log(err);
      return new JSDOM().window.document;
    });
}

export function snakeToPascal(str: string) {
return str.split("/")
  .map(snake => snake.split("_")
  .map(substr => substr.charAt(0)
      .toUpperCase() +
      substr.slice(1))
  .join(""))
  .join("/");
};

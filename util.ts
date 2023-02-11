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
